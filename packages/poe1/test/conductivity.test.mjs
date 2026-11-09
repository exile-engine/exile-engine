import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { calculateSelectedSkill, loadSparkDataset } from '@exile-engine/poe1';
import { fixtureReader } from '../../core/test/fixture-reader.mjs';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/spark-client.json', import.meta.url), 'utf8'),
);
const loaded = await loadSparkDataset(fixtureReader(fixture));
assert.equal(loaded.ok, true, JSON.stringify(loaded.diagnostics));
const dataset = loaded.value;
const curse = {
  id: 'Conductivity',
  gemLevel: 1,
  quality: 0,
  enabled: true,
  increasedEffectPercent: 0,
  source: { kind: 'scenario', id: 'already-active-conductivity' },
  effectSource: { kind: 'scenario', id: 'configured-curse-effect' },
};
const input = {
  identity: dataset.identity,
  buildId: 'conductivity-synthetic',
  skill: { id: 'Spark', gemLevel: 20, quality: 0 },
  configuration: {
    id: 'explicit-nonboss-enemy',
    criticalStrikeMode: 'average',
    ailmentMode: 'excluded',
    lightningResistance: {
      baseResistancePercent: 75,
      maximumResistanceMode: 'configured',
      source: { kind: 'scenario', id: 'base-resistance' },
      exposures: [],
      conductivity: curse,
    },
  },
  modifiers: [],
};
const result = (value) => {
  assert.equal(value.ok, true, JSON.stringify(value.diagnostics));
  return value.value;
};

test('normal Conductivity retains all twenty exact client levels, normal gem identity and non-damage facts', () => {
  const data = dataset.conductivity;
  assert.deepEqual(data.identity, dataset.identity);
  assert.equal(data.id, 'Conductivity');
  assert.equal(data.gemId, 'Metadata/Items/Gems/SkillGemConductivity');
  assert.equal(data.chanceToBeShockedPercent, 25);
  assert.equal(data.levels.length, 20);
  for (const level of data.levels) {
    const raw = fixture.tables.GrantedEffectStatSetsPerLevel.find(
      (row) => row.StatSet === 2440 && row.GemLevel === level.gemLevel,
    );
    assert.equal(level.baseLightningResistancePercent, raw.AdditionalStatsValues[2]);
    assert.equal(level.durationMilliseconds, raw.AdditionalStatsValues[0]);
    assert.equal(level.radiusIncrement, raw.AdditionalStatsValues[1]);
    assert.ok(
      level.sourceRows.some(
        (row) => row.table === 'GrantedEffectStatSetsPerLevel' && row.rowIndex === raw._index,
      ),
    );
  }
  assert.equal(data.levels[0].baseLightningResistancePercent, -17);
  assert.equal(data.levels[19].baseLightningResistancePercent, -36);
  for (const [table, key] of [
    ['Stats', 'base_lightning_damage_resistance_%'],
    ['Stats', 'chance_to_be_shocked_%'],
    ['Stats', 'curse_effect_+%'],
    ['Stats', 'base_deal_no_damage'],
    ['ActiveSkillType', 'Hex'],
    ['ActiveSkillType', 'AppliesCurse'],
    ['SkillGems', 'SkillGems:184'],
  ])
    assert.ok(
      data.sourceRows.some((row) => row.table === table && row.key === key),
      key,
    );
  assert.equal(data.ruleSource.kind, 'external');
  assert.match(data.ruleSource.id, /3dbca446.*ModStore:56-83/);
});

test('curse scaling rounds to two decimals then truncates negative resistance toward zero', () => {
  for (const [effect, scaled, rounded, truncated, chance] of [
    [0, -17, -17, -17, 25],
    [25, -21.25, -21.25, -21, 31],
    [-50, -8.5, -8.5, -8, 12],
    [-100, -0, 0, 0, 0],
    [200, -51, -51, -51, 75],
  ]) {
    const selected = structuredClone(input);
    selected.configuration.lightningResistance.conductivity.increasedEffectPercent = effect;
    const calculation = result(calculateSelectedSkill(selected, dataset));
    const trace = calculation.resistanceEffects.conductivity;
    assert.equal(trace.scaledLightningResistancePercent, scaled);
    assert.equal(trace.roundedLightningResistancePercent, rounded);
    assert.equal(trace.truncatedLightningResistancePercent, truncated);
    assert.equal(trace.appliedLightningResistancePercent, truncated);
    assert.equal(trace.effectMultiplier, 1 + effect / 100);
    assert.equal(trace.resistanceContribution.statId, 'base_lightning_damage_resistance_%');
    assert.equal(trace.resistanceContribution.value, truncated);
    assert.deepEqual(trace.resistanceContribution.source, curse.source);
    assert.equal(trace.effectContribution.statId, 'curse_effect_+%');
    assert.equal(trace.effectContribution.value, effect);
    assert.deepEqual(trace.effectContribution.source, curse.effectSource);
    assert.deepEqual(trace.excludedShockChance, {
      statId: 'chance_to_be_shocked_%',
      basePercent: 25,
      scaledPercent: chance,
      appliedToSelectedHit: false,
      source: curse.source,
    });
    assert.equal(calculation.shockEffects.mode, 'excluded');
    assert.equal(calculation.shockEffects.averageDamageMultiplier, 1);
    assert.equal(calculation.criticalEffects.chancePercent, 6);
  }
});

test('already-active curse lowers uncapped resistance before caps and penetration; disabled state keeps its facts', () => {
  const selected = structuredClone(input);
  const raw = selected.configuration.lightningResistance;
  raw.baseResistancePercent = 110;
  raw.exposures = [
    {
      statId: 'lightning_exposure_on_hit_magnitude',
      value: -15,
      enabled: true,
      source: { kind: 'scenario', id: 'exposure' },
    },
  ];
  selected.modifiers = [
    {
      statId: 'base_reduce_enemy_lightning_resistance_%',
      value: 20,
      source: { kind: 'item', id: 'robe', line: 5 },
    },
  ];
  let calc = result(calculateSelectedSkill(selected, dataset));
  assert.equal(calc.resistanceEffects.uncappedResistancePercent, 78);
  assert.equal(calc.resistanceEffects.cappedResistancePercent, 78);
  assert.equal(calc.resistanceEffects.effectiveResistancePercent, 58);
  raw.conductivity.gemLevel = 20;
  raw.conductivity.increasedEffectPercent = 50;
  calc = result(calculateSelectedSkill(selected, dataset));
  assert.equal(calc.resistanceEffects.conductivity.appliedLightningResistancePercent, -54);
  assert.equal(calc.resistanceEffects.effectiveResistancePercent, 21);
  assert.equal(calc.resistanceEffects.conductivity.durationMilliseconds, 11800);
  assert.equal(calc.resistanceEffects.conductivity.radiusIncrement, 10);
  raw.conductivity.enabled = false;
  calc = result(calculateSelectedSkill(selected, dataset));
  assert.equal(calc.resistanceEffects.conductivity.truncatedLightningResistancePercent, -54);
  assert.equal(calc.resistanceEffects.conductivity.appliedLightningResistancePercent, 0);
  assert.equal(calc.resistanceEffects.effectiveResistancePercent, 70);
  raw.conductivity.enabled = true;
  raw.baseResistancePercent = -190;
  assert.equal(
    result(calculateSelectedSkill(selected, dataset)).resistanceEffects.effectiveResistancePercent,
    -220,
  );
  const absent = structuredClone(input);
  delete absent.configuration.lightningResistance.conductivity;
  assert.equal(
    result(calculateSelectedSkill(absent, dataset)).resistanceEffects.conductivity,
    null,
  );
  selected.modifiers.push({
    statId: 'damage_+%',
    value: -100,
    source: { kind: 'item', id: 'zero-damage' },
  });
  const zero = result(calculateSelectedSkill(selected, dataset));
  assert.equal(zero.combinedDps, 0);
  assert.equal(zero.resistanceEffects.effectiveResistancePercent, -220);
  assert.equal(zero.resistanceEffects.conductivity.excludedShockChance.appliedToSelectedHit, false);
});

test('missing, unsupported and ambiguous curse state returns diagnostics rather than a complete calculation', () => {
  for (const mutate of [
    (cfg) => {
      cfg.id = 'ElementalWeakness';
    },
    (cfg) => {
      cfg.gemLevel = 0;
    },
    (cfg) => {
      cfg.gemLevel = 21;
    },
    (cfg) => {
      cfg.gemLevel = 1.5;
    },
    (cfg) => {
      cfg.quality = 1;
    },
    (cfg) => {
      cfg.enabled = 'true';
    },
    (cfg) => {
      cfg.increasedEffectPercent = -101;
    },
    (cfg) => {
      cfg.increasedEffectPercent = 201;
    },
    (cfg) => {
      cfg.increasedEffectPercent = 0.5;
    },
    (cfg) => {
      cfg.increasedEffectPercent = NaN;
    },
    (cfg) => {
      delete cfg.effectSource;
    },
    (cfg) => {
      cfg.effectSource = { kind: 'item', id: 'unreviewed-item-effect' };
    },
    (cfg) => {
      cfg.source = Object.create(cfg.source);
    },
    (cfg) => {
      cfg.effectSource.id = '';
    },
    (cfg) => {
      cfg.conditions = ['on-hit'];
    },
  ]) {
    const selected = structuredClone(input);
    mutate(selected.configuration.lightningResistance.conductivity);
    const calculated = calculateSelectedSkill(selected, dataset);
    assert.equal(calculated.ok, false);
    assert.equal('value' in calculated, false);
  }
  const missing = structuredClone(dataset);
  delete missing.conductivity;
  const disabled = structuredClone(input);
  disabled.configuration.lightningResistance.conductivity.enabled = false;
  assert.equal(calculateSelectedSkill(disabled, missing).ok, false);
  const noPolicy = structuredClone(input);
  delete noPolicy.configuration.ailmentMode;
  delete noPolicy.configuration.criticalStrikeMode;
  assert.equal(calculateSelectedSkill(noPolicy, dataset).ok, false);
});

test('normalized curse records reject hidden cycles, inherited facts, sparse levels and snapshot mismatches', () => {
  for (const mutate of [
    (data) => {
      data.conductivity.identity.snapshotId += 'different';
    },
    (data) => {
      delete data.conductivity.levels[0];
    },
    (data) => {
      data.conductivity.levels[0].baseLightningResistancePercent = 1;
    },
    (data) => {
      data.conductivity.levels[0].baseLightningResistancePercent = -17.5;
    },
    (data) => {
      data.conductivity.chanceToBeShockedPercent = 30;
    },
    (data) => {
      data.conductivity.levels[0].durationMilliseconds = Infinity;
    },
    (data) => {
      data.conductivity.levels[0].radiusIncrement = -1;
    },
    (data) => {
      data.conductivity.ruleSource.id = 'unknown-rule';
    },
    (data) => {
      data.conductivity.levels[0] = Object.create(data.conductivity.levels[0]);
    },
    (data) => {
      data.conductivity.sourceRows[0].cycle = data;
    },
  ]) {
    const data = structuredClone(dataset);
    mutate(data);
    assert.equal(calculateSelectedSkill(input, data).ok, false);
  }
  const selected = structuredClone(input);
  const owned = structuredClone(dataset);
  const calculated = result(calculateSelectedSkill(selected, owned));
  selected.configuration.lightningResistance.conductivity.source.id = 'host-mutated';
  selected.configuration.lightningResistance.conductivity.effectSource.id = 'host-effect-mutated';
  owned.conductivity.sourceRows[0].key = 'host-row-mutated';
  assert.equal(calculated.resistanceEffects.conductivity.configuration.source.id, curse.source.id);
  assert.equal(
    calculated.resistanceEffects.conductivity.resistanceContribution.source.id,
    curse.source.id,
  );
  assert.equal(
    calculated.resistanceEffects.conductivity.effectContribution.source.id,
    curse.effectSource.id,
  );
  assert.equal(
    calculated.resistanceEffects.conductivity.excludedShockChance.source.id,
    curse.source.id,
  );
  assert.notEqual(calculated.resistanceEffects.conductivity.sourceRows[0].key, 'host-row-mutated');
});

test('normalization rejects unreviewed curse mechanics and malformed source references', async () => {
  for (const mutate of [
    (f) => {
      f.tables.GrantedEffects.find((row) => row.Id === 'Conductivity').IsSupport = true;
    },
    (f) => {
      f.tables.GrantedEffectStatSets.find((row) => row.Id === 'Conductivity').ImplicitStats = [535];
    },
    (f) => {
      f.tables.GrantedEffectStatSets.find((row) => row.Id === 'Conductivity').ConstantStatsValues =
        [30];
    },
    (f) => {
      f.tables.GrantedEffectStatSetsPerLevel.find(
        (row) => row.StatSet === 2440,
      ).AdditionalStats.reverse();
    },
    (f) => {
      f.tables.GrantedEffectStatSetsPerLevel.find(
        (row) => row.StatSet === 2440,
      ).AdditionalStatsValues[2] = -17.5;
    },
    (f) => {
      f.tables.GrantedEffectStatSetsPerLevel.find(
        (row) => row.StatSet === 2440,
      ).AdditionalStatsValues[0] = 0;
    },
    (f) => {
      f.tables.GrantedEffectStatSetsPerLevel = f.tables.GrantedEffectStatSetsPerLevel.filter(
        (row) => !(row.StatSet === 2440 && row.GemLevel === 20),
      );
    },
    (f) => {
      f.tables.SkillGems.find((row) => row._index === 184).GemVariants = [];
    },
  ]) {
    const changed = structuredClone(fixture);
    mutate(changed);
    assert.equal((await loadSparkDataset(fixtureReader(changed))).ok, false);
  }
  for (const [table, key, field] of [
    ['GrantedEffectStatSetsPerLevel', 'GrantedEffectStatSetsPerLevel:23027', 'AdditionalStats'],
    ['ActiveSkills', 'conductivity', 'ActiveSkillTypes'],
  ]) {
    const reader = fixtureReader(fixture);
    const row = await reader.getRecord(table, key);
    row.fields[field][0] = { ...row.fields[field][0], rowIndex: 999999 };
    assert.equal((await loadSparkDataset(reader)).ok, false);
  }
  const malformedEffect = fixtureReader(fixture);
  (await malformedEffect.getRecord('Stats', 'curse_effect_+%')).rowIndex = -1;
  assert.equal((await loadSparkDataset(malformedEffect)).ok, false);
});
