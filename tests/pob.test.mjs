import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { importPobXml, pobAdapterVersion, pobCompatibility, pobXmlLimits } from '@exile-engine/pob';

const target = { game: 'poe1', build: '26474023', snapshotId: 'explicit-test-snapshot' };
const fixtures = Object.fromEntries(
  await Promise.all(
    [
      'baseline',
      'increased',
      'cast',
      'resisted',
      'no-damage',
      'missing-config',
      'unsupported',
      'added-lightning',
      'added-lightning-multiple',
      'added-lightning-combined',
      'added-lightning-level1',
      'added-lightning-rounded',
      'added-lightning-zero',
      'added-lightning-reversed',
      'support-controlled-destruction-level1',
      'support-controlled-destruction-level20',
      'support-controlled-destruction-combined',
      'support-controlled-destruction-disabled',
      'support-controlled-destruction-rounded',
      'crit-baseline',
      'crit-increased',
      'crit-multiplier',
      'crit-controlled-active',
      'crit-controlled-disabled',
      'crit-controlled-cap',
      'crit-cap',
      'crit-zero',
      'crit-rounded',
      'crit-combined',
      'lightning-penetration',
      'lightning-exposure',
      'lightning-exposure-strongest',
      'lightning-exposure-disabled',
      'lightning-overcap',
      'lightning-fixed-cap',
      'lightning-negative',
      'lightning-floor',
      'lightning-penetration-sum',
      'lightning-resistance-combined',
      'shock-full',
      'shock-zero-uptime',
      'shock-partial',
      'shock-zero-magnitude',
      'shock-minimum',
      'shock-maximum',
      'shock-combined',
      'shock-no-damage',
      ...[
        'level1',
        'level20',
        'disabled',
        'both',
        'both-reversed',
        'combined',
        'rounded',
        'tick-cap',
        'rescued',
      ].map((suffix) => `support-faster-casting-${suffix}`),
    ].map(async (name) => [
      name,
      await readFile(new URL(`./fixtures/pob/${name}.xml`, import.meta.url), 'utf8'),
    ]),
  ),
);
const source = (xml = fixtures.baseline, shockUptimePercent) => ({
  format: 'pob-xml',
  xml,
  target,
  buildId: 'synthetic-spark',
  configurationId: 'explicit-enemy',
  ...(shockUptimePercent === undefined ? {} : { shockUptimePercent }),
});
const rawResistance = (
  baseResistancePercent,
  maximumResistanceMode = 'configured',
  exposures = [],
) => ({
  baseResistancePercent,
  maximumResistanceMode,
  source: {
    kind: 'scenario',
    id: 'pob-config:enemyLightningResist',
    label: `enemyLightningResist=${baseResistancePercent}`,
  },
  exposures,
});

test('PoB capability advertises exactly the bounded XML profile', () => {
  assert.equal(pobAdapterVersion, 'poe1-spark-xml-v7');
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
    'Adds 1 to 10 Fire Damage to Spells',
  );
});

test('added spell lightning preserves each ordered stat pair and item-line provenance', () => {
  const imported = importPobXml(source(fixtures['added-lightning-multiple']));
  assert.equal(imported.complete, true, JSON.stringify(imported.diagnostics));
  assert.deepEqual(imported.modifiers, []);
  assert.deepEqual(
    imported.addedLightningDamage.map(({ statIds, values, source, scope }) => ({
      statIds,
      values,
      source,
      scope,
    })),
    [
      {
        statIds: ['spell_minimum_added_lightning_damage', 'spell_maximum_added_lightning_damage'],
        values: [10, 20],
        scope: 'global',
        source: {
          kind: 'item',
          id: 'pob-item:1',
          line: 5,
          label: 'Adds 10 to 20 Lightning Damage to Spells',
        },
      },
      {
        statIds: ['spell_minimum_added_lightning_damage', 'spell_maximum_added_lightning_damage'],
        values: [3, 7],
        scope: 'global',
        source: {
          kind: 'item',
          id: 'pob-item:1',
          line: 6,
          label: 'Adds 3 to 7 Lightning Damage to Spells',
        },
      },
    ],
  );
  assert.deepEqual(imported.selectedSkill.addedLightningDamage, imported.addedLightningDamage);
  assert.deepEqual(imported.selectedSkill.identity, target);
  const leading = importPobXml(
    source(fixtures['added-lightning'].replace('<![CDATA[Rarity:', '<![CDATA[\n\nRarity:')),
  );
  assert.equal(leading.addedLightningDamage[0].source.line, 7);
});

test('all bounded added-lightning fixtures adapt raw endpoints without applying effectiveness', () => {
  for (const name of [
    'added-lightning',
    'added-lightning-multiple',
    'added-lightning-combined',
    'added-lightning-level1',
    'added-lightning-rounded',
    'added-lightning-zero',
  ]) {
    const imported = importPobXml(source(fixtures[name]));
    assert.equal(imported.complete, true, name + JSON.stringify(imported.diagnostics));
    assert.equal(imported.selectedSkill.skill.gemLevel, name === 'added-lightning-level1' ? 1 : 20);
    assert.equal(imported.rawXml, fixtures[name]);
  }
  assert.deepEqual(
    importPobXml(source(fixtures['added-lightning'])).addedLightningDamage[0].values,
    [10, 20],
  );
  assert.deepEqual(
    importPobXml(source(fixtures['added-lightning-rounded'])).addedLightningDamage[0].values,
    [1, 2],
  );
  assert.deepEqual(
    importPobXml(source(fixtures['added-lightning-zero'])).addedLightningDamage[0].values,
    [0, 0],
  );
  const combined = importPobXml(source(fixtures['added-lightning-combined']));
  assert.equal(combined.modifiers.length, 5);
  assert.equal(combined.addedLightningDamage.length, 1);
  assert.equal(combined.modifiers[0].source.line, 6);
  assert.equal(combined.selectedSkill.configuration.lightningResistance.baseResistancePercent, 25);
  const absent = importPobXml(source());
  assert.deepEqual(absent.addedLightningDamage, []);
  assert.equal('addedLightningDamage' in absent.selectedSkill, false);
});

test('reversed, oversized, decimal, attack, generic and conditional added damage remain unresolved', () => {
  const rejected = [
    fixtures['added-lightning-reversed'],
    ...[
      'Adds -1 to 20 Lightning Damage to Spells',
      'Adds 1.5 to 20 Lightning Damage to Spells',
      'Adds 1 to 20 Lightning Damage',
      'Adds 1 to 20 Lightning Damage to Attacks',
      'Adds 1 to 20 Lightning Damage to Spells while on Low Life',
      'Adds 1 to 20 Lightning Damage to Spells (local)',
      'Adds 1 to 20 Fire Damage to Spells',
      'Adds 9007199254740992 to 9007199254740992 Lightning Damage to Spells',
      'Adds NaN to 20 Lightning Damage to Spells',
      'Adds 1 to Infinity Lightning Damage to Spells',
    ].map((line) =>
      fixtures['added-lightning'].replace('Adds 10 to 20 Lightning Damage to Spells', line),
    ),
  ];
  for (const xml of rejected) {
    const imported = importPobXml(source(xml));
    assert.equal(imported.complete, false, xml);
    assert.equal('selectedSkill' in imported, false);
    assert.equal(imported.unresolved.length, 1);
    assert.equal(imported.rawXml, xml);
  }
  const reversed = importPobXml(source(fixtures['added-lightning-reversed']));
  assert.equal(reversed.diagnostics[0].code, 'pob.invalid-added-lightning-range');
  assert.equal(reversed.unresolved[0].reason, 'malformed-input');
  assert.equal(reversed.unresolved[0].source.textLine, 5);
});

test('one same-group normal Controlled Destruction support retains explicit state and gem provenance', () => {
  for (const name of [
    'support-controlled-destruction-level1',
    'support-controlled-destruction-level20',
    'support-controlled-destruction-combined',
    'support-controlled-destruction-disabled',
    'support-controlled-destruction-rounded',
  ]) {
    const imported = importPobXml(source(fixtures[name]));
    assert.equal(imported.complete, true, name + JSON.stringify(imported.diagnostics));
    assert.deepEqual(imported.supports, [
      {
        id: 'SupportControlledDestruction',
        gemLevel: name.endsWith('level1') ? 1 : 20,
        quality: 0,
        enabled: !name.endsWith('disabled'),
        source: { kind: 'skill', id: 'pob-gem:1:2', label: 'Controlled Destruction' },
      },
    ]);
    assert.deepEqual(imported.selectedSkill.skill.supports, imported.supports);
    assert.equal(imported.skills.length, 1);
    assert.equal(imported.skills[0].gameSkillId, 'Spark');
    assert.deepEqual(imported.selectedSkill.identity, target);
    assert.equal(imported.rawXml, fixtures[name]);
  }
  const combined = importPobXml(source(fixtures['support-controlled-destruction-combined']));
  assert.equal(combined.modifiers.length, 5);
  assert.deepEqual(combined.addedLightningDamage[0].values, [10, 20]);
  assert.equal(combined.selectedSkill.configuration.lightningResistance.baseResistancePercent, 25);
  assert.deepEqual(importPobXml(source()).supports, []);
});

test('unknown, duplicate, incompatible or differently scoped support gems block adaptation even when disabled', () => {
  const normal = fixtures['support-controlled-destruction-level20'];
  const support =
    '<Gem skillId="SupportControlledDestruction" gemId="Metadata/Items/Gems/SupportGemControlledDestruction" nameSpec="Controlled Destruction" level="20" quality="0" enabled="true"/>';
  assert.ok(normal.includes(support));
  const rejected = [
    normal.replace(
      'skillId="SupportControlledDestruction"',
      'skillId="SupportAddedLightningDamage"',
    ),
    normal.replace('SupportGemControlledDestruction', 'SkillGemSupportControlledDestruction'),
    normal.replace(
      'nameSpec="Controlled Destruction"',
      'nameSpec="Awakened Controlled Destruction"',
    ),
    normal.replace(support, support.replace('quality="0"', 'quality="1"')),
    normal.replace(support, support.replace('level="20"', 'level="21"')),
    normal.replace(support, support.replace('level="20"', 'level="0"')),
    normal.replace(support, support.replace('level="20"', 'level="1.5"')),
    normal.replace(support, support.replace(' enabled="true"', '')),
    normal.replace(support, support.replace('enabled="true"', 'enabled="yes"')),
    normal.replace(
      support,
      support
        .replace('SupportControlledDestruction', 'SupportUnknown')
        .replace('enabled="true"', 'enabled="false"'),
    ),
    normal.replace(support, support + support),
    normal.replace(support, support.replace('/>', ' unsupportedEffect="true"/>')),
    normal.replace(support, '').replace('<Gem skillId="Spark"', support + '<Gem skillId="Spark"'),
    fixtures.baseline.replace(
      '</Skills>',
      `<Skill enabled="true" mainActiveSkill="1" skillPart="1">${support}</Skill></Skills>`,
    ),
    normal.replace('mainActiveSkill="1"', 'mainActiveSkill="2"'),
  ];
  for (const xml of rejected) {
    const imported = importPobXml(source(xml));
    assert.equal(imported.complete, false, xml);
    assert.equal('selectedSkill' in imported, false);
    assert.ok(imported.unresolved.length);
    assert.equal(imported.rawXml, xml);
  }
  const unknown = importPobXml(source(rejected[0]));
  assert.equal(unknown.unresolved[0].source.gemIndex, 2);
  assert.equal(unknown.unresolved[0].source.socketGroup, 1);
});

test('Faster Casting and Controlled Destruction retain each selected gem and socket provenance', () => {
  for (const suffix of [
    'level1',
    'level20',
    'disabled',
    'both',
    'both-reversed',
    'combined',
    'rounded',
    'tick-cap',
    'rescued',
  ]) {
    const imported = importPobXml(
      source(fixtures[`support-faster-casting-${suffix}`], suffix === 'combined' ? 40 : undefined),
    );
    assert.equal(imported.complete, true, suffix + JSON.stringify(imported.diagnostics));
    assert.deepEqual(imported.selectedSkill.skill.supports, imported.supports);
    assert.deepEqual(imported.selectedSkill.identity, target);
    assert.equal(imported.selectedSkill.buildId, 'synthetic-spark');
    const faster = imported.supports.find((support) => support.id === 'SupportFasterCasting');
    assert.equal(faster.gemLevel, suffix === 'level1' || suffix === 'rescued' ? 1 : 20);
    assert.equal(faster.enabled, suffix !== 'disabled');
    assert.equal(
      faster.source.id,
      suffix === 'both' || suffix === 'combined' ? 'pob-gem:1:3' : 'pob-gem:1:2',
    );
    assert.equal(faster.source.label, 'Faster Casting');
    assert.equal(
      imported.modifiers.some((mod) => mod.source.kind === 'skill'),
      false,
    );
  }
  const forward = importPobXml(source(fixtures['support-faster-casting-both']));
  const reverse = importPobXml(source(fixtures['support-faster-casting-both-reversed']));
  assert.deepEqual(
    forward.supports.map((support) => support.id),
    ['SupportControlledDestruction', 'SupportFasterCasting'],
  );
  assert.deepEqual(
    reverse.supports.map((support) => support.id),
    ['SupportFasterCasting', 'SupportControlledDestruction'],
  );
  assert.equal(reverse.supports[1].source.id, 'pob-gem:1:3');
});

test('unreviewed Faster Casting variants, quality, duplicate gems and extra supports fail visibly', () => {
  const xml = fixtures['support-faster-casting-level20'];
  const gem = xml.match(/<Gem skillId="SupportFasterCasting"[^>]*\/>/)[0];
  for (const invalid of [
    gem.replace('SupportGemFasterCast', 'SupportGemFasterCasting'),
    gem.replace('SupportGemFasterCast', 'SkillGemSupportFasterCasting'),
    gem.replace('nameSpec="Faster Casting"', 'nameSpec="Awakened Faster Casting"'),
    gem.replace('quality="0"', 'quality="1"'),
    gem.replace('level="20"', 'level="21"'),
    gem.replace('level="20"', 'level="1.5"'),
    gem.replace('enabled="true"', 'enabled="false" unsupported="true"'),
    gem + gem,
    gem + gem.replace('enabled="true"', 'enabled="false"'),
    gem + gem + gem,
    gem
      .replace('SupportFasterCasting', 'SupportSpellEcho')
      .replace('enabled="true"', 'enabled="false"'),
  ]) {
    const result = importPobXml(source(xml.replace(gem, invalid)));
    assert.equal(result.complete, false, invalid);
    assert.equal('selectedSkill' in result, false);
    assert.ok(result.unresolved.length);
    assert.equal(result.rawXml, xml.replace(gem, invalid));
  }
  for (const amount of ['12.34', '12.00', '0.5']) {
    const fractional = fixtures['support-faster-casting-rounded'].replace(
      /[0-9]+(?:\.[0-9]+)?% increased Cast Speed/,
      `${amount}% increased Cast Speed`,
    );
    const result = importPobXml(source(fractional));
    assert.equal(result.complete, false);
    assert.equal('selectedSkill' in result, false);
    assert.ok(result.unresolved.some((entry) => entry.raw.includes(`${amount}%`)));
  }
});

test('fractional and unsafe XML percentage item lines retain diagnostics rather than disagreeing with native rounding', () => {
  for (const suffix of [
    'Damage',
    'Spell Damage',
    'Lightning Damage',
    'Projectile Damage',
    'Cast Speed',
  ]) {
    for (const amount of ['12.34', '12.00', '9007199254740992']) {
      const xml = fixtures.baseline.replace(
        'Implicits: 0',
        `Implicits: 0\n${amount}% increased ${suffix}`,
      );
      const result = importPobXml(source(xml));
      assert.equal(result.complete, false);
      assert.equal('selectedSkill' in result, false);
      assert.equal(result.rawXml, xml);
      assert.ok(result.unresolved.some((entry) => entry.raw === `${amount}% increased ${suffix}`));
    }
  }
});

test('average critical fixtures require the exact excluded-ailment declaration and preserve mode identity', () => {
  for (const name of [
    'crit-baseline',
    'crit-increased',
    'crit-multiplier',
    'crit-controlled-active',
    'crit-controlled-disabled',
    'crit-controlled-cap',
    'crit-cap',
    'crit-zero',
    'crit-rounded',
    'crit-combined',
  ]) {
    const imported = importPobXml(source(fixtures[name]));
    assert.equal(imported.complete, true, name + JSON.stringify(imported.diagnostics));
    assert.deepEqual(imported.selectedSkill.configuration, {
      id: 'explicit-enemy',
      lightningResistance: rawResistance(name === 'crit-combined' ? 25 : 0),
      criticalStrikeMode: 'average',
      ailmentMode: 'excluded',
    });
    assert.equal(imported.selectedSkill.buildId, 'synthetic-spark');
    assert.deepEqual(imported.selectedSkill.identity, target);
    assert.equal(imported.rawXml, fixtures[name]);
  }
  const disabled = importPobXml(
    source(
      fixtures['crit-increased'].replace(
        'Cannot inflict Elemental Ailments',
        'Never deal Critical Strikes',
      ),
    ),
  );
  assert.equal(disabled.complete, true);
  assert.deepEqual(disabled.selectedSkill.configuration, {
    id: 'explicit-enemy',
    lightningResistance: rawResistance(0),
  });
  assert.equal(disabled.modifiers.length, 2);
});

test('critical modifiers share the ordered scalar array and retain exact IDs and individual item lines', () => {
  const increased = importPobXml(source(fixtures['crit-increased']));
  assert.deepEqual(
    increased.modifiers.map(({ statId, value, source, scope }) => ({
      statId,
      value,
      source,
      scope,
    })),
    [
      {
        statId: 'critical_strike_chance_+%',
        value: 100,
        scope: 'global',
        source: {
          kind: 'item',
          id: 'pob-item:1',
          line: 5,
          label: '100% increased Critical Strike Chance',
        },
      },
      {
        statId: 'spell_critical_strike_chance_+%',
        value: 50,
        scope: 'global',
        source: {
          kind: 'item',
          id: 'pob-item:1',
          line: 6,
          label: '50% increased Critical Strike Chance for Spells',
        },
      },
    ],
  );
  assert.deepEqual(increased.selectedSkill.modifiers, increased.modifiers);
  const multiplier = importPobXml(source(fixtures['crit-multiplier']));
  assert.equal(multiplier.modifiers[0].statId, 'base_critical_strike_multiplier_+');
  assert.equal(multiplier.modifiers[0].value, 50);
  assert.equal(importPobXml(source(fixtures['crit-zero'])).modifiers[0].value, -100);
  assert.equal(importPobXml(source(fixtures['crit-rounded'])).modifiers[0].value, 17);
  const combined = importPobXml(source(fixtures['crit-combined']));
  assert.equal(combined.modifiers.length, 8);
  assert.deepEqual(
    combined.modifiers.slice(5).map(({ source }) => source.line),
    [11, 12, 13],
  );
  assert.deepEqual(combined.addedLightningDamage[0].values, [10, 20]);
  assert.equal(combined.supports[0].enabled, true);
  const repeated = importPobXml(
    source(
      fixtures['crit-increased'].replace(
        '50% increased Critical Strike Chance for Spells',
        '50% increased Critical Strike Chance for Spells\n25% increased Critical Strike Chance',
      ),
    ),
  );
  assert.deepEqual(
    repeated.modifiers.map(({ value }) => value),
    [100, 50, 25],
  );
});

test('missing ailment policy, lucky crits, flat crit, charges, local or conditional critical mechanics stay unresolved', () => {
  const average = fixtures['crit-baseline'];
  const rejected = [
    average.replace('Cannot inflict Elemental Ailments', ''),
    average.replace('Cannot inflict Elemental Ailments', 'Cannot Shock'),
    average.replace(
      'Cannot inflict Elemental Ailments',
      'Cannot inflict Elemental Ailments&#10;Never deal Critical Strikes',
    ),
    average.replace('Cannot inflict Elemental Ailments', 'Your Critical Strike Chance is Lucky'),
    average.replace('</Config>', '<Input name="conditionEnemyShocked" boolean="true"/></Config>'),
    ...[
      '+1% to Spell Critical Strike Chance',
      '100% increased Critical Strike Chance with Attacks',
      '100% increased Critical Strike Chance while on Full Life',
      '100% increased Critical Strike Chance (local)',
      '12.34% increased Critical Strike Chance for Spells',
      '12.34% increased Critical Strike Chance',
      '+50.5% to Global Critical Strike Multiplier',
      '9007199254740992% increased Critical Strike Chance',
      '+50% to Critical Strike Multiplier for Spell Damage',
      '+1 to Maximum Power Charges',
      '10% chance to Shock',
    ].map((line) => average.replace('Implicits: 0', 'Implicits: 0\n' + line)),
  ];
  for (const xml of rejected) {
    const imported = importPobXml(source(xml));
    assert.equal(imported.complete, false, xml);
    assert.equal('selectedSkill' in imported, false);
    assert.ok(imported.unresolved.length);
    assert.equal(imported.rawXml, xml);
  }
});

test('all lightning resistance fixtures preserve raw configured values, cap mode and scenario identity', () => {
  const expected = {
    'lightning-penetration': 75,
    'lightning-exposure': 75,
    'lightning-exposure-strongest': 75,
    'lightning-exposure-disabled': 75,
    'lightning-overcap': 110,
    'lightning-fixed-cap': 110,
    'lightning-negative': -50,
    'lightning-floor': -190,
    'lightning-penetration-sum': 75,
    'lightning-resistance-combined': 110,
  };
  for (const [name, resistance] of Object.entries(expected)) {
    const imported = importPobXml(source(fixtures[name]));
    assert.equal(imported.complete, true, name + JSON.stringify(imported.diagnostics));
    assert.equal(
      'effectiveLightningResistancePercent' in imported.selectedSkill.configuration,
      false,
    );
    const raw = imported.selectedSkill.configuration.lightningResistance;
    assert.equal(raw.baseResistancePercent, resistance);
    assert.equal(
      raw.maximumResistanceMode,
      name === 'lightning-fixed-cap' ? 'default75' : 'configured',
    );
    assert.deepEqual(raw.source, rawResistance(resistance).source);
    assert.equal(imported.selectedSkill.configuration.id, 'explicit-enemy');
    assert.equal(imported.rawXml, fixtures[name]);
  }
  const legacyXml = importPobXml(source());
  assert.deepEqual(legacyXml.selectedSkill.configuration.lightningResistance, rawResistance(0));
  assert.equal(
    importPobXml(source(fixtures.baseline.replace('number="0"', 'number="100"'))).complete,
    true,
  );
});

test('penetration stays in the ordered scalar list and exposure blocks retain every candidate and enabled state', () => {
  const pen = importPobXml(source(fixtures['lightning-penetration-sum']));
  assert.deepEqual(
    pen.modifiers.map(({ statId, value, source, scope }) => ({ statId, value, source, scope })),
    [10, 20].map((value, index) => ({
      statId: 'base_reduce_enemy_lightning_resistance_%',
      value,
      scope: 'global',
      source: {
        kind: 'item',
        id: 'pob-item:1',
        line: index + 5,
        label: `Damage Penetrates ${value}% Lightning Resistance`,
      },
    })),
  );
  const exposure = (value, index, enabled = true) => ({
    statId: 'lightning_exposure_on_hit_magnitude',
    value,
    enabled,
    source: {
      kind: 'scenario',
      id: `pob-config:exposure:Exposure ${index + 1}`,
      label: `Inflict Lightning Exposure on Hit, applying ${value}% to Lightning Resistance`,
      line: 1,
    },
  });
  const strongest = importPobXml(source(fixtures['lightning-exposure-strongest']));
  assert.deepEqual(strongest.selectedSkill.configuration.lightningResistance.exposures, [
    exposure(-10, 0),
    exposure(-25, 1),
  ]);
  const disabled = importPobXml(source(fixtures['lightning-exposure-disabled']));
  assert.deepEqual(disabled.selectedSkill.configuration.lightningResistance.exposures, [
    exposure(-10, 0),
    exposure(-25, 1, false),
  ]);
  const combined = importPobXml(source(fixtures['lightning-resistance-combined']));
  assert.equal(combined.modifiers.length, 9);
  assert.equal(combined.modifiers.at(-1).statId, 'base_reduce_enemy_lightning_resistance_%');
  assert.equal(combined.supports[0].enabled, true);
  assert.equal(combined.selectedSkill.configuration.criticalStrikeMode, 'average');
  assert.deepEqual(combined.addedLightningDamage[0].values, [10, 20]);
  const zero = importPobXml(
    source(fixtures['lightning-exposure'].replace('applying -15%', 'applying -0%')),
  );
  assert.equal(zero.complete, true);
  assert.equal(
    Object.is(zero.selectedSkill.configuration.lightningResistance.exposures[0].value, -0),
    true,
  );
});

test('mixed custom formats, unknown exposure blocks and unsupported cap or penetration mechanics fail visibly', () => {
  const exposed = fixtures['lightning-exposure'];
  const block =
    '<CustomModifierBlock title="Exposure 1" enabled="true">Inflict Lightning Exposure on Hit, applying -15% to Lightning Resistance</CustomModifierBlock>';
  assert.ok(exposed.includes(block));
  const malformed = [
    exposed.replace(
      '</Config>',
      '<Input name="customMods" string="Never deal Critical Strikes"/></Config>',
    ),
    exposed.replace(
      'title="Exile Engine Assumptions" enabled="true"',
      'title="Exile Engine Assumptions" enabled="false"',
    ),
    exposed.replace('title="Exile Engine Assumptions"', 'title="Unknown Assumptions"'),
    exposed.replace(block, block + block),
    exposed.replace('applying -15%', 'applying -101%'),
    exposed.replace('applying -15%', 'applying -15.5%'),
    exposed.replace('Lightning Exposure', 'Fire Exposure'),
    exposed.replace(
      block,
      block
        .replace('enabled="true"', 'enabled="false"')
        .replace(
          'Inflict Lightning Exposure on Hit, applying -15% to Lightning Resistance',
          'Damage is Lucky',
        ),
    ),
    exposed.replace('boolean="false"', 'number="75"'),
    exposed.replace('number="75"', 'number="75.5"'),
    exposed.replace('number="75"', 'number="-1001"'),
    exposed.replace(
      '</Config>',
      '<Input name="enemyMaximumLightningResist" number="85"/></Config>',
    ),
    exposed.replace(
      block,
      Array.from({ length: 9 }, (_, index) =>
        block.replace('Exposure 1', `Exposure ${index + 1}`),
      ).join(''),
    ),
    ...[
      'Damage Penetrates 201% Lightning Resistance',
      'Damage Penetrates -1% Lightning Resistance',
      'Damage Penetrates 10.5% Lightning Resistance',
      'Damage Penetrates 10% Elemental Resistances',
      'Damage Penetrates 10% Lightning Resistance while on Full Life',
      'Damage Penetrates 10% Lightning Resistance (local)',
    ].map((line) =>
      fixtures['lightning-penetration'].replace('Damage Penetrates 20% Lightning Resistance', line),
    ),
  ];
  for (const xml of malformed) {
    const imported = importPobXml(source(xml));
    assert.equal(imported.complete, false, xml);
    assert.equal('selectedSkill' in imported, false);
    assert.ok(imported.unresolved.length);
    assert.equal(imported.rawXml, xml);
  }
  assert.equal(importPobXml(source(malformed[0])).diagnostics[0].code, 'pob.ambiguous-assumptions');
});

test('configured shock retains native magnitude, explicit host uptime and their combined scenario provenance', () => {
  const scenarios = [
    ['shock-full', 20, 100],
    ['shock-zero-uptime', 20, 0],
    ['shock-partial', 20, 50],
    ['shock-zero-magnitude', 0, 100],
    ['shock-minimum', 1, 100],
    ['shock-maximum', 50, 100],
    ['shock-combined', 17, 40],
    ['shock-no-damage', 20, 100],
  ];
  for (const [name, magnitude, uptime] of scenarios) {
    const imported = importPobXml(source(fixtures[name], uptime));
    assert.equal(imported.complete, true, name + JSON.stringify(imported.diagnostics));
    const config = imported.selectedSkill.configuration;
    assert.equal(config.id, 'explicit-enemy');
    assert.equal(config.ailmentMode, 'configured-shock');
    assert.deepEqual(config.shock, {
      magnitudePercent: magnitude,
      uptimePercent: uptime,
      source: {
        kind: 'scenario',
        id: 'pob-config:shock',
        label: `conditionEnemyShocked=true; conditionShockEffect=${magnitude}; host shockUptimePercent=${uptime}`,
      },
    });
    assert.equal(imported.rawXml, fixtures[name]);
    assert.deepEqual(imported.selectedSkill.identity, target);
  }
  assert.equal(fixtures['shock-full'], fixtures['shock-partial']);
  assert.equal(fixtures['shock-full'], fixtures['shock-zero-uptime']);
  const combined = importPobXml(source(fixtures['shock-combined'], 40));
  assert.equal(combined.selectedSkill.configuration.criticalStrikeMode, 'average');
  assert.equal(combined.selectedSkill.configuration.lightningResistance.exposures[0].value, -15);
  assert.equal(combined.supports[0].enabled, true);
  assert.equal(combined.modifiers.at(-1).statId, 'base_reduce_enemy_lightning_resistance_%');
  assert.equal('shock' in importPobXml(source()).selectedSkill.configuration, false);
});

test('native false shock is explicit zero uptime; missing or contradictory metadata never supplies an inferred shock', () => {
  const full = fixtures['shock-full'];
  const off = full.replace(
    'name="conditionEnemyShocked" boolean="true"',
    'name="conditionEnemyShocked" boolean="false"',
  );
  const importedOff = importPobXml(source(off, 0));
  assert.equal(importedOff.complete, true);
  assert.equal(importedOff.selectedSkill.configuration.shock.magnitudePercent, 20);
  assert.equal(importedOff.selectedSkill.configuration.shock.uptimePercent, 0);
  assert.match(
    importedOff.selectedSkill.configuration.shock.source.label,
    /conditionEnemyShocked=false/,
  );
  const invalidSources = [
    source(full),
    { ...source(full), shockUptimePercent: undefined },
    source(off, 1),
    source(fixtures.baseline, 100),
    source(fixtures.baseline, 0),
    ...[-1, 101, 0.5, NaN, Infinity, '100', null].map((uptime) => ({
      ...source(full),
      shockUptimePercent: uptime,
    })),
    ...[
      full.replace('    <Input name="conditionShockEffect" number="20"/>\n', ''),
      full.replace('    <Input name="conditionEnemyShocked" boolean="true"/>\n', ''),
      full.replace(
        'name="conditionShockEffect" number="20"',
        'name="conditionShockEffect" number="51"',
      ),
      full.replace(
        'name="conditionShockEffect" number="20"',
        'name="conditionShockEffect" number="20.5"',
      ),
      full.replace(
        'name="conditionShockEffect" number="20"',
        'name="conditionShockEffect" number="-1"',
      ),
      full.replace(
        'name="conditionEnemyShocked" boolean="true"',
        'name="conditionEnemyShocked" number="1"',
      ),
      full.replace('</Config>', '<Input name="conditionEnemyChilled" boolean="true"/></Config>'),
      full.replace('Implicits: 0', 'Implicits: 0\n20% increased Effect of Shock'),
    ].map((xml) => source(xml, 100)),
  ];
  for (const input of invalidSources) {
    const imported = importPobXml(input);
    assert.equal(imported.complete, false, JSON.stringify(input));
    assert.equal('selectedSkill' in imported, false);
    assert.ok(imported.unresolved.length);
    assert.equal(imported.rawXml, input.xml);
  }
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
    fixtures.baseline.replace('number="0"', 'number="1001"'),
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
