import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (message) => {
  throw new Error(message);
};
export async function validateSnapshot(
  game,
  directory = path.join(ROOT, `packages/data-${game}/snapshot`),
) {
  const manifestBytes = await fs.readFile(path.join(directory, 'manifest.json'));
  if (manifestBytes.length > 4194304) fail('Oversized manifest.');
  const m = JSON.parse(manifestBytes);
  if (m.format !== 'exile-engine-snapshot-v1' || m.identity.game !== game)
    fail('Invalid snapshot identity.');
  const expected = m.identity.snapshotId;
  delete m.identity.snapshotId;
  if (hash(JSON.stringify(m)) !== expected) fail('Snapshot identity digest mismatch.');
  m.identity.snapshotId = expected;
  const profileBytes = await fs.readFile(path.join(ROOT, 'scripts/profiles/build-catalogs.json'));
  const profile = JSON.parse(profileBytes);
  if (hash(profileBytes) !== m.profileSha256)
    fail('Snapshot profile has drifted. Regenerate both snapshots.');
  const schema = await fs.readFile(path.join(ROOT, 'scripts/profiles', profile.schema));
  if (hash(schema) !== m.schema.sha256 || m.schema.sha256 !== profile.schemaSha256)
    fail('Snapshot schema has drifted.');
  if (
    hash(await fs.readFile(path.join(ROOT, 'scripts/extract-catalogs.mjs'))) !== m.extractorSha256
  )
    fail('Extractor has changed. Regenerate snapshots.');
  if (
    hash(await fs.readFile(path.join(ROOT, 'packages/item-text/src/index.ts'))) !==
    m.descriptionParserSha256
  )
    fail('Description parser has changed. Regenerate snapshots.');
  if (
    hash(await fs.readFile(path.join(ROOT, 'packages/item-text/dist/index.js'))) !==
    m.executedDescriptionParserSha256
  )
    fail('Executed parser artifact has changed. Rebuild and regenerate snapshots.');
  const expectedFiles = new Set(['manifest.json']);
  let byteCount = manifestBytes.length,
    shardCount = 0;
  async function readShards(shards) {
    const rows = [];
    for (const shard of shards) {
      if (
        typeof shard.path !== 'string' ||
        shard.path.includes('\\') ||
        shard.path.startsWith('/') ||
        shard.path.split('/').some((s) => !s || s === '.' || s === '..') ||
        !Number.isSafeInteger(shard.bytes) ||
        shard.bytes > 4194304 ||
        shard.bytes < 3 ||
        !Number.isSafeInteger(shard.records) ||
        shard.records < 0 ||
        !/^[a-f0-9]{64}$/.test(shard.sha256)
      )
        fail('Invalid shard descriptor.');
      if (expectedFiles.has(shard.path)) fail('Duplicate shard path: ' + shard.path);
      expectedFiles.add(shard.path);
      const bytes = await fs.readFile(path.join(directory, shard.path));
      if (bytes.length !== shard.bytes || hash(bytes) !== shard.sha256)
        fail('Shard identity mismatch: ' + shard.path);
      const values = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!Array.isArray(values) || values.length !== shard.records)
        fail('Shard count mismatch: ' + shard.path);
      rows.push(...values);
      byteCount += bytes.length;
      shardCount++;
    }
    return rows;
  }
  const tableKeys = new Map(),
    allRefs = [];
  function refs(value) {
    if (Array.isArray(value)) {
      for (const v of value) refs(v);
      return;
    }
    if (value && typeof value === 'object') {
      if (value.kind === 'ref') allRefs.push(value);
      else for (const v of Object.values(value)) refs(v);
    }
  }
  let rowCount = 0;
  for (const name of m.coverage.requiredTables)
    if (!m.tables[name]) fail('Missing required catalog: ' + name);
  for (const [name, table] of Object.entries(m.tables)) {
    const rows = await readShards(table.shards);
    if (rows.length !== table.rows) fail('Wrong catalog row count: ' + name);
    const keys = [];
    for (const [i, row] of rows.entries()) {
      if (
        row.rowIndex !== i ||
        typeof row.key !== 'string' ||
        !row.fields ||
        Array.isArray(row.fields)
      )
        fail('Invalid row: ' + name);
      keys.push(row.key);
      refs(row.fields);
    }
    if (new Set(keys).size !== keys.length) fail('Duplicate row key: ' + name);
    tableKeys.set(name, keys);
    rowCount += keys.length;
  }
  for (const ref of allRefs)
    if (tableKeys.get(ref.table)?.[ref.rowIndex] !== ref.key)
      fail('Unresolved normalized ref: ' + JSON.stringify(ref));
  const rules = await readShards(m.descriptions.shards);
  if (rules.length !== m.descriptions.rules) fail('SD rule count mismatch.');
  const ids = new Set();
  for (const rule of rules) {
    if (
      typeof rule.id !== 'string' ||
      ids.has(rule.id) ||
      !rule.statIds.length ||
      !Array.isArray(rule.variants) ||
      typeof rule.locale !== 'string' ||
      typeof rule.sourcePath !== 'string'
    )
      fail('Invalid SD rule.');
    ids.add(rule.id);
    for (const variant of rule.variants)
      if (
        variant.ranges.length !== rule.statIds.length ||
        typeof variant.text !== 'string' ||
        !Array.isArray(variant.transforms)
      )
        fail('Invalid SD variant.');
  }
  const files = await readShards(m.descriptions.fileShards);
  if (files.length !== m.descriptions.files) fail('SD file count mismatch.');
  const sources = new Set(files.map((f) => f.sourcePath.replaceAll('\\', '/').toLowerCase()));
  let sourceDiagnostics = 0;
  for (const file of files) {
    sourceDiagnostics += file.diagnostics.length;
    for (const include of file.includes) {
      const normalized = include.replaceAll('\\', '/').toLowerCase();
      if (!sources.has(normalized)) fail('Missing SD include: ' + include);
    }
  }
  const graphs = await readShards(m.passiveGraphs.shards);
  if (
    graphs.length !== m.passiveGraphs.records ||
    graphs.length !== m.tables.PassiveSkillTrees.rows
  )
    fail('Passive graph coverage mismatch.');
  let graphNodes = 0;
  const repeatedGraphNodeIds = [];
  for (const graph of graphs) {
    if (graph.version !== 3 || graph.parsedBytes !== graph.totalBytes)
      fail('Incomplete PSG parse.');
    const nodes = graph.groups.flatMap((g) => g.nodes),
      ids = new Set(nodes.map((n) => n.id));
    if (ids.size !== nodes.length) {
      const counts = new Map();
      for (const node of nodes) counts.set(node.id, (counts.get(node.id) || 0) + 1);
      for (const [id, occurrences] of counts)
        if (occurrences > 1) repeatedGraphNodeIds.push({ graph: graph.key, id, occurrences });
    }
    for (const node of nodes)
      for (const edge of node.connections)
        if (!ids.has(edge.id)) fail('PSG connection outside graph: ' + graph.key + ':' + edge.id);
    graphNodes += nodes.length;
  }
  const templates = await readShards(m.templates.shards),
    templatePaths = new Set(templates.map((t) => t.path));
  if (templates.length !== m.templates.records) fail('Template count mismatch.');
  for (const t of templates)
    if (t.extends && !templatePaths.has(t.extends)) fail('Missing template ancestor.');
  for (const [locale, tables] of Object.entries(m.localizations || {}))
    for (const [name, table] of Object.entries(tables)) {
      const rows = await readShards(table.shards),
        keys = tableKeys.get(name);
      if (
        rows.length !== table.rows ||
        rows.length !== keys.length ||
        rows.some((r, i) => r.key !== keys[i] || r.rowIndex !== i)
      )
        fail('Localized ID coverage mismatch: ' + locale + '/' + name);
    }
  async function inventory(dir, prefix = '') {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const rel = prefix + entry.name;
      if (entry.isDirectory()) await inventory(path.join(dir, entry.name), rel + '/');
      else if (!expectedFiles.has(rel)) fail('Unreferenced snapshot file: ' + rel);
    }
  }
  await inventory(directory);
  return {
    game,
    build: m.identity.build,
    snapshotId: expected,
    tables: tableKeys.size,
    rows: rowCount,
    descriptionFiles: files.length,
    descriptionRules: rules.length,
    locales: m.descriptions.locales,
    localizedLabels: Object.keys(m.localizations || {}),
    templates: templates.length,
    graphs: graphs.length,
    graphNodes,
    repeatedGraphNodeIds,
    shards: shardCount,
    bytes: byteCount,
    unresolvedClientReferences: m.coverage.unresolvedClientReferences.length,
    sourceDiagnostics,
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  for (const game of ['poe1', 'poe2']) console.log(JSON.stringify(await validateSnapshot(game)));
