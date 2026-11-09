import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fail = (message) => {
  throw new Error(message);
};
const json = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const profilePath = path.join(ROOT, 'scripts/profiles/build-catalogs.json');
const normalize = (value) => value.replaceAll('\\', '/').toLowerCase();
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const text = (bytes) =>
  new TextDecoder(bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : 'utf-8')
    .decode(bytes)
    .replace(/^\uFEFF/, '');
function options(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || !argv[i + 1]) fail('Expected named options with values.');
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}
function child(root, relative) {
  const result = path.resolve(root, relative);
  if (!result.startsWith(path.resolve(root) + path.sep)) fail('Unsafe relative file: ' + relative);
  return result;
}
export async function writeShards(directory, prefix, values, limit = 4194304) {
  const shards = [];
  let parts = [],
    size = 2;
  async function flush() {
    if (!parts.length) return;
    const raw = '[' + parts.join(',') + ']\n';
    const relative = `${prefix}-${String(shards.length).padStart(4, '0')}.json`;
    const target = child(directory, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, raw);
    shards.push({
      path: relative,
      sha256: hash(raw),
      bytes: Buffer.byteLength(raw),
      records: parts.length,
    });
    parts = [];
    size = 2;
  }
  for (const value of values) {
    const raw = JSON.stringify(value);
    const bytes = Buffer.byteLength(raw);
    if (bytes + 3 > limit) fail('A single catalog record exceeds shard limit: ' + prefix);
    if (size + bytes + (parts.length ? 1 : 0) + 1 > limit) await flush();
    size += bytes + (parts.length ? 1 : 0);
    parts.push(raw);
  }
  await flush();
  return shards;
}
async function openClient(clientRoot, toolRoot, game) {
  const profile = await json(profilePath);
  const parent = path.dirname(toolRoot);
  for (const [name, version] of Object.entries(profile.tools)) {
    const actual = await json(
      path.join(name === 'pathofexile-dat' ? toolRoot : path.join(parent, name), 'package.json'),
    );
    if (actual.version !== version || actual.name !== name)
      fail('Unpinned extraction tool: ' + name);
  }
  const [bundle, dat, pathsModule] = await Promise.all(
    ['bundles.js', 'dat.js', 'bundles/index-paths.js'].map(
      (name) => import(pathToFileURL(path.join(toolRoot, 'dist', name))),
    ),
  );
  const appid = game === 'poe1' ? '238960' : '2694490';
  const appmanifestPath = path.resolve(clientRoot, `../../appmanifest_${appid}.acf`);
  const appmanifest = await fs.readFile(appmanifestPath);
  const evidence = appmanifest.toString('utf8');
  if (!new RegExp(`"appid"\\s+"${appid}"`).test(evidence)) fail('Wrong Steam app manifest.');
  const build = /"buildid"\s+"(\d+)"/.exec(evidence)?.[1];
  if (!build) fail('No installed build identity.');
  const packedIndex = await fs.readFile(path.join(clientRoot, 'Bundles2/_.index.bin'));
  const indexSize = bundle.decompressedBundleSize(packedIndex);
  if (indexSize < 1 || indexSize > 512 * 1024 * 1024) fail('Index exceeds extraction limit.');
  const unpacked = new Uint8Array(indexSize);
  bundle.decompressSliceInBundle(packedIndex, 0, unpacked);
  const index = bundle.readIndexBundle(unpacked);
  const reps = new Uint8Array(bundle.decompressedBundleSize(index.pathRepsBundle));
  bundle.decompressSliceInBundle(index.pathRepsBundle, 0, reps);
  const indexedPaths = pathsModule.unpackPaths(reps);
  const selectedPaths = new Map();
  const sdRoot = profile.descriptionRoots[game];
  const descriptionPaths = [],
    templatePaths = [],
    localizationPaths = [];
  for (const name of indexedPaths) {
    const key = normalize(name);
    if (
      key.endsWith('.datc64') ||
      key.endsWith('.psg') ||
      key.endsWith('.it') ||
      key.startsWith(sdRoot)
    ) {
      if (selectedPaths.has(key)) fail('Ambiguous indexed path: ' + key);
      selectedPaths.set(key, name);
    }
    if (key.startsWith(sdRoot) && /\.(txt|csd)$/.test(key)) descriptionPaths.push(name);
    if (key.startsWith('metadata/items/') && key.endsWith('.it')) templatePaths.push(name);
    const dataRoot = game === 'poe2' ? 'data/balance/' : 'data/';
    if (key.startsWith(dataRoot)) {
      const rest = key.slice(dataRoot.length),
        m = /^([^/]+)\/(baseitemtypes|itemclasses)\.datc64$/.exec(rest);
      if (m)
        localizationPaths.push({
          path: name,
          locale: m[1],
          table: m[2] === 'baseitemtypes' ? 'BaseItemTypes' : 'ItemClasses',
        });
    }
  }
  indexedPaths.length = 0;
  let cachedPath = '',
    packed;
  const bundles = new Map(),
    sources = new Map();
  async function read(name) {
    const actual = selectedPaths.get(normalize(name));
    if (!actual) fail('Missing indexed input: ' + name);
    const info = bundle.getFileInfo(actual, index.bundlesInfo, index.filesInfo);
    if (!info || info.size < 1 || info.size > 256 * 1024 * 1024)
      fail('Invalid asset size: ' + actual);
    const target = child(path.join(clientRoot, 'Bundles2'), info.bundle);
    if (cachedPath !== target) {
      packed = await fs.readFile(target);
      cachedPath = target;
      const fingerprint = {
        path: normalize(info.bundle),
        bytes: packed.length,
        sha256: hash(packed),
      };
      const previous = bundles.get(target);
      if (previous && previous.sha256 !== fingerprint.sha256)
        fail('Source changed during extraction: ' + info.bundle);
      bundles.set(target, fingerprint);
    }
    const bytes = new Uint8Array(info.size);
    bundle.decompressSliceInBundle(packed, info.offset, bytes);
    sources.set(actual, {
      path: actual.replaceAll('\\', '/'),
      bytes: bytes.length,
      sha256: hash(bytes),
      bundle: normalize(info.bundle),
    });
    return bytes;
  }
  return {
    dat,
    read,
    build,
    has: (name) => selectedPaths.has(normalize(name)),
    descriptionPaths: descriptionPaths.sort(),
    templatePaths: templatePaths.sort(),
    localizationPaths: localizationPaths.sort((a, b) => compareText(a.path, b.path)),
    source: {
      appId: appid,
      appmanifestSha256: hash(appmanifest),
      indexSha256: hash(packedIndex),
      indexBytes: packedIndex.length,
    },
    sources,
    bundles,
    async verify() {
      if (hash(await fs.readFile(appmanifestPath)) !== hash(appmanifest))
        fail('Build evidence changed during extraction.');
      if (
        hash(await fs.readFile(path.join(clientRoot, 'Bundles2/_.index.bin'))) !== hash(packedIndex)
      )
        fail('Client index changed during extraction.');
      for (const [file, proof] of bundles)
        if (hash(await fs.readFile(file)) !== proof.sha256)
          fail('Source bundle changed before acceptance: ' + proof.path);
    },
  };
}
function decodeTable(dat, definition, bytes, onlyId = false) {
  const file = dat.readDatFile('.datc64', bytes);
  if (file.rowCount > 2_000_000) fail('Table row count limit: ' + definition.name);
  let offset = 0;
  const columns = [];
  for (const [position, c] of definition.columns.entries()) {
    const header = {
      name: c.name || `@unknown:${position}`,
      offset,
      type: {
        array: c.array,
        interval: c.interval,
        integer: ['u16', 'u32', 'i16', 'i32', 'enumrow'].includes(c.type)
          ? { unsigned: c.type[0] === 'u', size: c.type.endsWith('16') ? 2 : 4 }
          : undefined,
        decimal: c.type === 'f32' ? { size: 4 } : undefined,
        string: c.type === 'string' ? {} : undefined,
        boolean: c.type === 'bool' ? {} : undefined,
        key: ['row', 'foreignrow'].includes(c.type)
          ? { foreign: c.type === 'foreignrow' }
          : undefined,
      },
    };
    offset += dat.getHeaderLength(header, file);
    if (!onlyId || c.name === 'Id')
      columns.push({ definition: c, name: header.name, values: dat.readColumn(header, file) });
  }
  if (file.rowCount > 0 && offset !== file.rowLength)
    fail(`Schema width mismatch ${definition.name}: expected ${offset}, actual ${file.rowLength}`);
  const id = columns.find((c) => c.name === 'Id');
  const keys = Array.from({ length: file.rowCount }, (_, i) =>
    id && id.values[i] != null ? String(id.values[i]) : `${definition.name}:${i}`,
  );
  const unique = new Set(keys);
  if (unique.size !== keys.length) fail('Duplicate catalog keys: ' + definition.name);
  return { rowCount: file.rowCount, rowLength: file.rowLength, columns, keys };
}
function closure(schema, profile, game) {
  const mask = game === 'poe1' ? 1 : 2;
  const definitions = new Map(
    schema.tables.filter((t) => t.validFor & mask).map((t) => [t.name, t]),
  );
  const seeds = [...profile.commonSeeds, ...profile.gameSeeds[game]];
  const allowed = new Set(profile.followReferenceTargets),
    selected = new Set();
  const queue = [...seeds];
  const followRefs = {};
  while (queue.length) {
    const name = queue.shift();
    if (selected.has(name)) continue;
    const table = definitions.get(name);
    if (!table) fail('Missing required schema table: ' + name);
    selected.add(name);
    followRefs[name] = [];
    for (const column of table.columns) {
      const target = column.references?.table;
      if (column.name && target && allowed.has(target) && definitions.has(target)) {
        followRefs[name].push(column.name);
        queue.push(target);
      }
    }
  }
  return { definitions, names: [...selected].sort(), followRefs, seeds };
}
function refValue(value, column, table, keys, byId, follow, unresolved) {
  if (value == null || !column.references || column.type === 'enumrow') return value;
  if (Array.isArray(value))
    return value.map((v) =>
      refValue(v, { ...column, array: false }, table, keys, byId, follow, unresolved),
    );
  const target = column.references.table;
  const targetKeys = keys.get(target);
  const index = typeof value === 'number' ? value : byId.get(target)?.get(String(value));
  if (typeof index === 'number' && index < 0) return null;
  if (follow && targetKeys) {
    if (!Number.isSafeInteger(index) || !targetKeys[index]) {
      const issue = {
        table,
        column: column.name,
        target,
        value,
        reason: 'unresolved-client-reference',
      };
      unresolved.set(JSON.stringify(issue), issue);
      return {
        kind: 'source-ref',
        table: target,
        rowIndex: typeof index === 'number' ? index : -1,
        sourceColumn: column.references.column || column.name,
        key: String(value),
        reason: 'unresolved-client-reference',
      };
    }
    return { kind: 'ref', table: target, key: targetKeys[index], rowIndex: index };
  }
  return {
    kind: 'source-ref',
    table: target,
    rowIndex: typeof index === 'number' ? index : -1,
    sourceColumn: column.references.column || column.name,
    ...(typeof value === 'string' ? { key: value } : {}),
  };
}
export function parseTemplate(source, sourcePath) {
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/);
  const extendsPath = /^\s*extends\s+"([^"]+)"/m.exec(source)?.[1] || null;
  const tokens = [],
    stack = [];
  let pending = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (
      !line ||
      line.startsWith('//') ||
      line.startsWith('#') ||
      /^extends\b/.test(line) ||
      /^version\b/.test(line)
    )
      continue;
    if (line === '{') {
      stack.push(pending);
      pending = '';
      continue;
    }
    if (line === '}') {
      if (!stack.length) fail('Unbalanced template: ' + sourcePath);
      stack.pop();
      continue;
    }
    const assignment = /^([\w.+%-]+)\s*=\s*(.*)$/.exec(line);
    if (assignment) {
      let value = assignment[2];
      try {
        value = JSON.parse(value);
      } catch {
        /* Keep exact unsupported literal. */
      }
      tokens.push({ scope: [...stack], name: assignment[1], value, sourceLine: i + 1 });
    } else pending = line;
  }
  if (stack.length) fail('Unclosed template: ' + sourcePath);
  return {
    path: sourcePath,
    extends:
      extendsPath && extendsPath !== 'nothing'
        ? normalize(extendsPath.endsWith('.it') ? extendsPath : extendsPath + '.it')
        : null,
    tokens,
  };
}
export function parsePassiveGraph(bytes, sourcePath, game = 'poe2') {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const need = (n) => {
    if (offset + n > bytes.length) fail('Truncated PSG: ' + sourcePath);
  };
  const u8 = () => {
    need(1);
    return view.getUint8(offset++);
  };
  const u32 = () => {
    need(4);
    const n = view.getUint32(offset, true);
    offset += 4;
    return n;
  };
  const f32 = () => {
    need(4);
    const n = view.getFloat32(offset, true);
    offset += 4;
    if (!Number.isFinite(n)) fail('Invalid PSG coordinate');
    return n;
  };
  const count = () => {
    const n = u32();
    if (n > 100000) fail('PSG count limit');
    return n;
  };
  const version = u8(),
    graphType = u8(),
    orbitCount = u8();
  if (version !== 3) fail('Unsupported PSG version ' + version + ': ' + sourcePath);
  if (orbitCount > 32) fail('Unsupported PSG orbit count');
  const orbitSizes = Array.from({ length: orbitCount }, u8);
  const roots = [];
  for (let i = 0, n = count(); i < n; i++) {
    if (game === 'poe1') roots.push(String(u32()));
    else {
      need(8);
      roots.push(view.getBigUint64(offset, true).toString());
      offset += 8;
    }
  }
  const groups = [];
  for (let i = 0, n = count(); i < n; i++) {
    const group = {
      id: i,
      x: f32(),
      y: f32(),
      flags: u32(),
      unknown: u32(),
      extra: u8(),
      nodes: [],
    };
    for (let j = 0, m = count(); j < m; j++) {
      const node = { id: u32(), orbit: u32(), orbitIndex: u32(), connections: [] };
      for (let k = 0, c = count(); k < c; k++)
        node.connections.push(game === 'poe1' ? { id: u32() } : { id: u32(), orbit: u32() });
      group.nodes.push(node);
    }
    groups.push(group);
  }
  if (offset !== bytes.length)
    fail('Unparsed PSG bytes: ' + sourcePath + ' at ' + offset + '/' + bytes.length);
  return {
    path: sourcePath,
    version,
    graphType,
    orbitSizes,
    roots,
    groups,
    parsedBytes: offset,
    totalBytes: bytes.length,
  };
}
async function parseDescriptions(client, out, profile, parserFile) {
  const parser = await import(pathToFileURL(parserFile));
  const rules = [],
    files = [];
  for (const sourcePath of client.descriptionPaths) {
    const bytes = await client.read(sourcePath);
    if ((profile.auxiliaryDescriptionFiles || []).includes(normalize(sourcePath))) {
      files.push({
        sourcePath,
        kind: 'stat-filter',
        includes: [],
        noDescriptionStatIds: [],
        directives: [],
        unparsedLines: [],
        diagnostics: [],
        rules: 0,
        lines: text(bytes).split(/\r?\n/),
      });
      continue;
    }
    const result = parser.parseStatDescriptions(text(bytes), { sourcePath });
    const fatal = new Set([
      'invalid-stat-declaration',
      'invalid-handed-stat-declaration',
      'missing-variant',
      'invalid-variant',
    ]);
    const errors = result.diagnostics.filter((d) => d.severity === 'error' || fatal.has(d.code));
    if (errors.length)
      fail(`Malformed SD input ${sourcePath}: ${JSON.stringify(errors.slice(0, 3))}`);
    rules.push(...result.rules);
    files.push({
      sourcePath,
      includes: result.includes,
      noDescriptionStatIds: result.noDescriptionStatIds,
      directives: result.directives || [],
      unparsedLines: result.unparsedLines || [],
      diagnostics: result.diagnostics,
      rules: result.rules.length,
    });
  }
  if (!files.length || !rules.length) fail('No stat description coverage.');
  const grouped = new Map();
  for (const rule of rules) {
    const key = rule.locale + '\0' + rule.scope;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(rule);
  }
  const shards = [];
  for (const key of [...grouped.keys()].sort()) {
    const rows = grouped.get(key),
      first = rows[0];
    const groupShards = await writeShards(
      out,
      'descriptions/' + first.locale + '/' + first.scope,
      rows,
      profile.maxShardBytes,
    );
    for (const shard of groupShards) {
      shard.scopes = [first.scope];
      shard.locales = [first.locale];
    }
    shards.push(...groupShards);
  }
  return {
    rules: rules.length,
    files: files.length,
    locales: [...new Set(rules.map((r) => r.locale))].sort(),
    shards,
    fileShards: await writeShards(out, 'descriptions/files', files, profile.maxShardBytes),
  };
}
async function extract(game, clientRoot, toolRoot, parserFile) {
  const extractorBytes = await fs.readFile(fileURLToPath(import.meta.url));
  const parserBytes = await fs.readFile(parserFile);
  const profileBytes = await fs.readFile(profilePath),
    profile = JSON.parse(profileBytes);
  const schemaBytes = await fs.readFile(path.join(path.dirname(profilePath), profile.schema));
  if (hash(schemaBytes) !== profile.schemaSha256) fail('Pinned schema hash mismatch.');
  const schema = JSON.parse(schemaBytes),
    plan = closure(schema, profile, game);
  const client = await openClient(clientRoot, toolRoot, game);
  const destination = path.join(ROOT, `packages/data-${game}/snapshot`);
  const tempRoot = path.join(ROOT, 'temp');
  await fs.mkdir(tempRoot, { recursive: true });
  const out = await fs.mkdtemp(path.join(tempRoot, `catalog-stage-${game}-`));
  const tablePath = (name) =>
    (game === 'poe2' ? 'data/balance/' : 'data/') + name.toLowerCase() + '.datc64';
  const missing = plan.names.filter((name) => !client.has(tablePath(name)));
  if (missing.length) fail('Required physical tables absent from client: ' + missing.join(', '));
  const keys = new Map(),
    byId = new Map();
  for (const name of plan.names) {
    const result = decodeTable(
      client.dat,
      plan.definitions.get(name),
      await client.read(tablePath(name)),
      true,
    );
    keys.set(name, result.keys);
    byId.set(name, new Map(result.keys.map((k, i) => [k, i])));
  }
  const manifest = {
    format: 'exile-engine-snapshot-v1',
    identity: { game, build: client.build },
    schema: { format: schema.version, createdAt: schema.createdAt, sha256: hash(schemaBytes) },
    profileSha256: hash(profileBytes),
    extractorSha256: hash(extractorBytes),
    descriptionParserSha256: hash(
      await fs.readFile(path.join(ROOT, 'packages/item-text/src/index.ts')),
    ),
    executedDescriptionParserSha256: hash(parserBytes),
    tools: profile.tools,
    source: client.source,
    tables: {},
    enumerations: schema.enumerations,
    coverage: {
      requiredTables: plan.seeds,
      followRefs: plan.followRefs,
      excludedReferencePolicy: 'source-ref',
      runtimeRuleCoverage: 'Catalog availability does not imply calculation support.',
    },
  };
  let baseRows, treeRows;
  const unresolved = new Map();
  for (const name of plan.names) {
    const definition = plan.definitions.get(name),
      bytes = await client.read(tablePath(name));
    const result = decodeTable(client.dat, definition, bytes);
    const records = Array.from({ length: result.rowCount }, (_, i) => ({
      key: result.keys[i],
      rowIndex: i,
      fields: Object.fromEntries(
        result.columns.map((c) => [
          c.name,
          refValue(
            c.values[i],
            c.definition,
            name,
            keys,
            byId,
            plan.followRefs[name].includes(c.definition.name),
            unresolved,
          ),
        ]),
      ),
    }));
    manifest.tables[name] = {
      rows: records.length,
      rowBytes: result.rowLength,
      sourcePath: tablePath(name),
      sourceSha256: hash(bytes),
      columns: definition.columns,
      shards: await writeShards(out, 'tables/' + name, records, profile.maxShardBytes),
    };
    if (name === 'BaseItemTypes') baseRows = records;
    if (name === 'PassiveSkillTrees') treeRows = records;
    console.log(
      JSON.stringify({
        game,
        build: client.build,
        table: name,
        rows: records.length,
        shards: manifest.tables[name].shards.length,
      }),
    );
  }
  const templates = new Map();
  async function loadTemplate(sourcePath, visiting = new Set()) {
    const p = normalize(sourcePath.endsWith('.it') ? sourcePath : sourcePath + '.it');
    if (templates.has(p)) return;
    if (visiting.has(p)) fail('Template inheritance cycle: ' + p);
    visiting.add(p);
    const parsed = parseTemplate(text(await client.read(p)), p);
    if (parsed.extends) await loadTemplate(parsed.extends, visiting);
    visiting.delete(p);
    templates.set(p, parsed);
  }
  for (const row of baseRows || []) {
    const value = row.fields.BaseType || row.fields.InheritsFrom;
    if (typeof value === 'string' && value !== 'nothing') await loadTemplate(value);
  }
  for (const sourcePath of client.templatePaths) await loadTemplate(sourcePath);
  manifest.templates = {
    records: templates.size,
    shards: await writeShards(
      out,
      'templates/records',
      [...templates.values()].sort((a, b) => compareText(a.path, b.path)),
      profile.maxShardBytes,
    ),
  };
  const graphs = [];
  for (const row of treeRows || []) {
    const source = row.fields.PassiveSkillGraph;
    if (typeof source === 'string' && source) {
      const p = source.endsWith('.psg') ? source : source + '.psg';
      graphs.push({ key: row.key, ...parsePassiveGraph(await client.read(p), p, game) });
    }
  }
  if (!graphs.length) fail('No passive graph coverage.');
  manifest.passiveGraphs = {
    records: graphs.length,
    shards: await writeShards(out, 'graphs/records', graphs, profile.maxShardBytes),
  };
  manifest.descriptions = await parseDescriptions(client, out, profile, parserFile);
  const { normalizeLocale } = await import(pathToFileURL(parserFile));
  manifest.localizations = {};
  for (const input of client.localizationPaths) {
    const locale = normalizeLocale(input.locale),
      definition = plan.definitions.get(input.table);
    const decoded = decodeTable(client.dat, definition, await client.read(input.path));
    const englishKeys = keys.get(input.table);
    if (
      decoded.rowCount !== englishKeys.length ||
      decoded.keys.some((key, i) => key !== englishKeys[i])
    )
      fail('Localized canonical IDs mismatch: ' + input.path);
    const selected = decoded.columns.filter(
      (c) =>
        c.name === 'Id' ||
        c.name === 'Name' ||
        (c.definition.localized && c.definition.type === 'string'),
    );
    const rows = decoded.keys.map((key, i) => ({
      key,
      rowIndex: i,
      fields: Object.fromEntries(selected.map((c) => [c.name, c.values[i]])),
    }));
    const bucket = (manifest.localizations[locale] ||= {});
    if (bucket[input.table]) fail('Ambiguous locale table: ' + locale + '/' + input.table);
    bucket[input.table] = {
      rows: rows.length,
      sourcePath: input.path,
      shards: await writeShards(
        out,
        'localizations/' + locale + '/' + input.table,
        rows,
        profile.maxShardBytes,
      ),
    };
  }
  manifest.coverage.unresolvedClientReferences = [...unresolved.values()];
  await client.verify();
  if (
    hash(await fs.readFile(parserFile)) !== hash(parserBytes) ||
    hash(await fs.readFile(fileURLToPath(import.meta.url))) !== hash(extractorBytes)
  )
    fail('Extractor/parser changed while running.');
  manifest.inputs = {
    files: [...client.sources.values()].sort((a, b) => compareText(a.path, b.path)),
    bundles: [...client.bundles.values()].sort((a, b) => compareText(a.path, b.path)),
  };
  manifest.identity.snapshotId = hash(JSON.stringify(manifest));
  const raw = JSON.stringify(manifest) + '\n';
  if (Buffer.byteLength(raw) > profile.maxShardBytes) fail('Manifest exceeds shard size.');
  await fs.writeFile(path.join(out, 'manifest.json'), raw);
  const { validateSnapshot } = await import('./validate-data.mjs');
  await validateSnapshot(game, out);
  const backup = path.join(tempRoot, `catalog-backup-${game}-${process.pid}`);
  if (
    path.dirname(destination) !== path.join(ROOT, `packages/data-${game}`) ||
    path.basename(destination) !== 'snapshot' ||
    path.dirname(out) !== tempRoot ||
    !path.basename(out).startsWith(`catalog-stage-${game}-`) ||
    path.dirname(backup) !== tempRoot
  )
    fail('Unsafe publication paths.');
  let hadDestination = false;
  try {
    await fs.rename(destination, backup);
    hadDestination = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    await fs.rename(out, destination);
  } catch (error) {
    if (hadDestination) await fs.rename(backup, destination);
    throw error;
  }
  if (hadDestination) await fs.rm(backup, { recursive: true, force: true });
  console.log(
    JSON.stringify({
      complete: true,
      game,
      identity: manifest.identity,
      tables: plan.names.length,
      descriptionRules: manifest.descriptions.rules,
      templates: templates.size,
      graphs: graphs.length,
    }),
  );
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = options(process.argv.slice(2));
  if (!['poe1', 'poe2'].includes(a.game) || !a['client-root'] || !a['tool-root'])
    fail(
      'Required --game poe1|poe2 --client-root <installed-client> --tool-root <external pathofexile-dat package>',
    );
  await extract(
    a.game,
    a['client-root'],
    a['tool-root'],
    a['sd-parser'] || path.join(ROOT, 'packages/item-text/dist/index.js'),
  );
}
