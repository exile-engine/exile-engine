import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { importPobXml, pobCompatibility, pobXmlLimits } from '@exile-engine/pob';

const target = { game: 'poe1', build: '26474023', snapshotId: 'explicit-test-snapshot' };
const fixtures = Object.fromEntries(
  await Promise.all(
    ['baseline', 'increased', 'cast', 'resisted', 'no-damage', 'missing-config', 'unsupported'].map(
      async (name) => [
        name,
        await readFile(new URL(`./fixtures/pob/${name}.xml`, import.meta.url), 'utf8'),
      ],
    ),
  ),
);
const source = (xml = fixtures.baseline) => ({
  format: 'pob-xml',
  xml,
  target,
  buildId: 'synthetic-spark',
  configurationId: 'explicit-enemy',
});

test('PoB capability advertises exactly the bounded XML profile', () => {
  assert.equal(pobCompatibility.status, 'bounded-poe1-spark-xml');
  assert.equal(pobCompatibility.xmlImportImplemented, true);
  assert.equal(pobCompatibility.shareCodeImportImplemented, false);
  assert.deepEqual(pobCompatibility.supportedGames, ['poe1']);
});

test('supported fixtures preserve identities and selected normal Spark without trusting saved DPS', () => {
  for (const name of ['baseline', 'increased', 'cast', 'resisted', 'no-damage']) {
    const input = source(fixtures[name]);
    const before = structuredClone(input);
    const imported = importPobXml(input);
    assert.equal(imported.complete, true, JSON.stringify(imported.diagnostics));
    assert.deepEqual(imported.identity, target);
    assert.deepEqual(imported.selectedSkill.identity, target);
    assert.equal(imported.selectedSkill.buildId, input.buildId);
    assert.equal(imported.selectedSkill.configuration.id, input.configurationId);
    assert.deepEqual(imported.selectedSkill.skill, {
      id: 'Spark',
      gemLevel: 20,
      quality: 0,
      variant: 'normal',
      statSet: 'base',
      supports: [],
    });
    assert.equal(imported.rawXml, fixtures[name]);
    assert.equal('CombinedDPS' in imported.selectedSkill, false);
    assert.deepEqual(input, before);
  }
});

test('individual ordered modifier occurrences keep exact game IDs and original item text lines', () => {
  const imported = importPobXml(source(fixtures.resisted));
  assert.deepEqual(
    imported.modifiers.map(({ statId, value }) => [statId, value]),
    [
      ['damage_+%', 10],
      ['spell_damage_+%', 20],
      ['lightning_damage_+%', 30],
      ['projectile_damage_+%', 40],
      ['base_cast_speed_+%', 25],
    ],
  );
  assert.deepEqual(
    imported.modifiers.map(({ source }) => [source.id, source.line]),
    Array.from({ length: 5 }, (_, index) => ['pob-item:1', index + 5]),
  );
  const leading = importPobXml(
    source(fixtures.increased.replace('<![CDATA[Rarity:', '<![CDATA[\n\nRarity:')),
  );
  assert.equal(leading.modifiers[0].source.line, 7);
  const repeated = importPobXml(
    source(
      fixtures.increased.replace(
        '20% increased Spell Damage',
        '20% increased Spell Damage\n5% increased Spell Damage',
      ),
    ),
  );
  assert.deepEqual(
    repeated.modifiers
      .filter(({ statId }) => statId === 'spell_damage_+%')
      .map(({ value }) => value),
    [20, 5],
  );
  assert.equal(importPobXml(source(fixtures['no-damage'])).modifiers[0].value, -100);
});

test('missing enemy configuration and unsupported mechanics retain unresolved data without calculation input', () => {
  for (const name of ['missing-config', 'unsupported']) {
    const imported = importPobXml(source(fixtures[name]));
    assert.equal(imported.complete, false);
    assert.equal('selectedSkill' in imported, false);
    assert.ok(imported.diagnostics.length > 0);
    assert.ok(imported.unresolved.length > 0);
    assert.equal(imported.rawXml, fixtures[name]);
  }
  assert.equal(
    importPobXml(source(fixtures.unsupported)).unresolved[0].raw,
    'Adds 1 to 10 Lightning Damage to Spells',
  );
});

test('ambiguous selection, unsupported version hints and mechanics fail visibly', () => {
  const variants = [
    fixtures.baseline.replace('skillId="Spark"', 'skillId="VaalSpark"'),
    fixtures.baseline.replace('quality="0"', 'quality="101"'),
    fixtures.baseline.replace('skillPart="1"', 'skillPart="2"'),
    fixtures.baseline.replace(' skillPart="1"', ''),
    fixtures.baseline.replace(
      '</Skills>',
      '<Skill enabled="true" mainActiveSkill="1" skillPart="1"/></Skills>',
    ),
    fixtures.baseline.replace('</Skill>', '<Gem skillId="SupportAddedLightningDamage"/></Skill>'),
    fixtures.baseline.replace('<Config>', '<Config><Input name="enemyIsBoss" string="None"/>'),
    fixtures.baseline.replace(
      '</Config>',
      '<Input name="conditionEnemyShocked" boolean="true"/></Config>',
    ),
    fixtures.baseline.replace('number="0"', 'number="100"'),
    fixtures.baseline.replace(
      '</PathOfBuilding>',
      '<Tree><Spec nodes="123"/></Tree></PathOfBuilding>',
    ),
    fixtures.baseline.replace('Simple Robe', 'Driftwood Wand'),
    fixtures.baseline.replace('Implicits: 0', 'Implicits: 1'),
    fixtures.baseline.replace('itemId="1"', 'itemId="2"'),
    fixtures.baseline.replace('level="1" className', 'level="90" className'),
    fixtures.baseline.replace(' targetVersion="3_0"', ''),
    fixtures.baseline.replace('targetVersion="3_0"', 'targetVersion="2_6"'),
    fixtures.baseline.replace('<PathOfBuilding>', '<PathOfBuilding game="poe2">'),
  ];
  for (const xml of variants) {
    const imported = importPobXml(source(xml));
    assert.equal(imported.complete, false, xml);
    assert.equal('selectedSkill' in imported, false);
    assert.ok(imported.unresolved.length);
  }
  for (const input of [
    null,
    {},
    { ...source(), target: { ...target, game: 'poe2' } },
    { ...source(), configurationId: '' },
    { ...source(), gameVersion: 'other' },
    { ...source(), target: { ...target, patch: 'other' } },
  ])
    assert.equal(importPobXml(input).complete, false);
});

test('XML parser treats entities and attributes as data and forbids resolution or executable declarations', () => {
  const valid = fixtures.baseline.replace(
    '</PathOfBuilding>',
    '<Notes>&lt;script&gt;&amp; &#65; &#x42;</Notes></PathOfBuilding>',
  );
  assert.equal(importPobXml(source(valid)).complete, true);
  const malformed = [
    '<!DOCTYPE PathOfBuilding [<!ENTITY a SYSTEM "https://example.invalid/">]>' + fixtures.baseline,
    fixtures.baseline.replace('<Config>', '<?processor run="anything"?><Config>'),
    fixtures.baseline.replace('className="Witch"', 'className="&remote;"'),
    fixtures.baseline.replace('className="Witch"', 'className="&#0;"'),
    fixtures.baseline.replace('className="Witch"', 'className="Witch" className="Witch"'),
    fixtures.baseline.replace('</Config>', '</Skills>'),
    fixtures.baseline + '<PathOfBuilding/>',
    fixtures.baseline + '<!--invalid--->',
    fixtures.baseline.replace('className="Witch"', 'className=Witch'),
    fixtures.baseline.replace('</PathOfBuilding>', '<Notes>&unclosed</Notes></PathOfBuilding>'),
    fixtures.baseline.replace('</PathOfBuilding>', '<Notes>]]></Notes></PathOfBuilding>'),
    fixtures.baseline.replace('</PathOfBuilding>', '<Notes>\u0000</Notes></PathOfBuilding>'),
  ];
  for (const xml of malformed) {
    const imported = importPobXml(source(xml));
    assert.equal(imported.complete, false);
    assert.match(imported.diagnostics[0].code, /^pob\.xml-/);
  }
});

test('XML bytes, depth, node, attribute and text work limits are enforced and cannot be enlarged', () => {
  const limitCases = [
    [fixtures.baseline, { maxBytes: 100 }],
    [fixtures.baseline, { maxDepth: 2 }],
    [fixtures.baseline, { maxNodes: 2 }],
    [fixtures.baseline, { maxAttributes: 2 }],
    [fixtures.baseline, { maxTextLength: 20 }],
    [fixtures.baseline, { maxBytes: pobXmlLimits.maxBytes + 1 }],
    [fixtures.baseline, { maxBytes: 0 }],
    [fixtures.baseline, { unknown: 1 }],
    ['<PathOfBuilding>' + 'ก'.repeat(100_000) + '</PathOfBuilding>', undefined],
    ['<PathOfBuilding>' + '<a>'.repeat(17) + '</a>'.repeat(17) + '</PathOfBuilding>', undefined],
    ['<PathOfBuilding>' + '<a/>'.repeat(1024) + '</PathOfBuilding>', undefined],
  ];
  for (const [xml, limits] of limitCases) {
    const imported = importPobXml(source(xml), limits);
    assert.equal(imported.complete, false);
    assert.equal(imported.diagnostics[0].code, 'pob.xml-limit');
  }
});
