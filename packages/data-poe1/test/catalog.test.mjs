import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createCatalogReader, loadCatalog } from '../dist/index.js';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const sign = (manifest) => {
  delete manifest.identity.snapshotId;
  manifest.identity.snapshotId = hash(JSON.stringify(manifest));
  return manifest;
};
function fixture() {
  const files = new Map();
  const shard = (path, rows) => {
    const raw = JSON.stringify(rows) + '\n';
    files.set(path, raw);
    return { path, bytes: Buffer.byteLength(raw), records: rows.length, sha256: hash(raw) };
  };
  const manifest = {
    format: 'exile-engine-snapshot-v1',
    identity: { game: 'poe1', build: 'fixture' },
    tables: {
      Stats: {
        rows: 1,
        shards: [
          shard('tables/Stats-0000.json', [
            { key: 'base_maximum_life', rowIndex: 0, fields: { Id: 'base_maximum_life' } },
          ]),
        ],
      },
    },
    descriptions: { files: 0, rules: 0, shards: [], fileShards: [], locales: [] },
    templates: { records: 0, shards: [] },
    passiveGraphs: { records: 0, shards: [] },
  };
  const read = async (path) => {
    if (!files.has(path)) throw Error('Missing fixture');
    return files.get(path);
  };
  return { manifest: sign(manifest), read, shard };
}
test('catalog preserves exact identifiers and guards reference row identity', async () => {
  const f = fixture(),
    reader = createCatalogReader(f.manifest, f.read);
  const row = await reader.getRecord('Stats', 'base_maximum_life');
  assert.equal(row.fields.Id, 'base_maximum_life');
  assert.equal(
    await reader.resolve({ kind: 'ref', table: 'Stats', key: row.key, rowIndex: 0 }),
    row,
  );
  assert.equal(
    await reader.resolve({ kind: 'ref', table: 'Stats', key: row.key, rowIndex: 1 }),
    undefined,
  );
  await assert.rejects(reader.getTable('NotIncluded'), /absent/);
});
test('reader verifies manifest identity and shard bytes before accepting records', async () => {
  const f = fixture();
  f.manifest.identity.build = 'changed';
  await assert.rejects(
    createCatalogReader(f.manifest, f.read).getTable('Stats'),
    /manifest identity/,
  );
  const bad = fixture();
  await assert.rejects(
    createCatalogReader(bad.manifest, async () => '[]\n').getTable('Stats'),
    /size mismatch/,
  );
  const digest = fixture();
  digest.manifest.tables.Stats.shards[0].sha256 = '0'.repeat(64);
  sign(digest.manifest);
  await assert.rejects(
    createCatalogReader(digest.manifest, digest.read).getTable('Stats'),
    /hash mismatch/,
  );
});
test('unsafe paths and invalid descriptors never reach host I/O', async () => {
  for (const path of [
    '../outside.json',
    'file:C:/secret',
    'https:example.com',
    '%2e%2e/secret',
    'a?x=1',
    'a#fragment',
    'a\\b',
  ]) {
    const f = fixture();
    f.manifest.tables.Stats.shards[0].path = path;
    sign(f.manifest);
    let calls = 0;
    await assert.rejects(
      createCatalogReader(f.manifest, async () => {
        calls++;
        return '[]';
      }).getTable('Stats'),
      /Unsafe shard path/,
    );
    assert.equal(calls, 0);
  }
  const f = fixture();
  f.manifest.tables.Stats.shards[0].bytes = Infinity;
  sign(f.manifest);
  let calls = 0;
  await assert.rejects(
    createCatalogReader(f.manifest, async () => {
      calls++;
      return '[]';
    }).getTable('Stats'),
    /descriptor/,
  );
  assert.equal(calls, 0);
});
test('portable host injection supports runtimes without built-in WebCrypto', async () => {
  const f = fixture();
  const host = {
    encodeUtf8: (s) => new TextEncoder().encode(s),
    decodeUtf8: (b) => new TextDecoder('utf-8', { fatal: true }).decode(b),
    sha256: async (b) => hash(b),
  };
  assert.equal(
    (await createCatalogReader(f.manifest, f.read, { host }).getTable('Stats')).length,
    1,
  );
});
test('scope resolution follows includes and respects child override and no_description', async () => {
  const f = fixture(),
    rule = (id, scope, stat) => ({
      id,
      groupId: id,
      scope,
      sourcePath: scope + '.txt',
      locale: 'en',
      statIds: [stat],
      variants: [],
    });
  const parent = 'metadata/statdescriptions/parent',
    child = 'metadata/statdescriptions/child';
  f.manifest.descriptions = {
    files: 2,
    rules: 3,
    locales: ['en'],
    shards: [
      f.shard('descriptions/rules.json', [
        rule('p1', parent, 'life'),
        rule('p2', parent, 'hidden'),
        rule('c1', child, 'life'),
      ]),
    ],
    fileShards: [
      f.shard('descriptions/files.json', [
        {
          sourcePath: parent + '.txt',
          includes: [],
          noDescriptionStatIds: [],
          rules: 2,
          directives: [],
          unparsedLines: [],
          diagnostics: [],
        },
        {
          sourcePath: child + '.txt',
          includes: [parent + '.txt'],
          noDescriptionStatIds: ['hidden'],
          rules: 1,
          directives: [],
          unparsedLines: [],
          diagnostics: [],
        },
      ]),
    ],
  };
  sign(f.manifest);
  const reader = createCatalogReader(f.manifest, f.read);
  assert.deepEqual(
    (await reader.getDescriptions('child', 'en')).map((r) => r.id),
    ['c1'],
  );
  assert.equal((await reader.getDescriptions()).length, 3);
  assert.equal((await reader.getDescriptionFiles()).length, 2);
});
test('committed snapshot loads exact Stats and Thai labels through its public reader', async () => {
  const base = new URL('../snapshot/', import.meta.url);
  const reader = await loadCatalog(async (p) => new Uint8Array(await readFile(new URL(p, base))));
  assert.equal(reader.identity.game, 'poe1');
  assert.ok(await reader.getRecord('Stats', 'base_maximum_life'));
  const thai = await reader.getLocalizedTable('BaseItemTypes', 'th');
  assert.ok(
    thai.some(
      (row) => typeof row.fields.Name === 'string' && /[\u0E00-\u0E7F]/.test(row.fields.Name),
    ),
  );
});
