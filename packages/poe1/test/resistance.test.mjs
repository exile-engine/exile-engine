import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { calculateSelectedSkill, calculateSpark, loadSparkDataset } from '@exile-engine/poe1';
import { fixtureReader } from '../../core/test/fixture-reader.mjs';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/spark-client.json', import.meta.url), 'utf8'),
);
const loaded = await loadSparkDataset(fixtureReader(fixture));
assert.equal(loaded.ok, true, JSON.stringify(loaded.diagnostics));
const dataset = loaded.value;
const exposure = (value, enabled = true, id = 'exposure:1') => ({
  statId: 'lightning_exposure_on_hit_magnitude',
  value,
  enabled,
  source: { kind: 'scenario', id },
});
const pen = (value, line = 5) => ({
  statId: 'base_reduce_enemy_lightning_resistance_%',
  value,
  source: { kind: 'item', id: 'robe:1', line },
});
const basic = {
  identity: dataset.identity,
  buildId: 'lightning-resistance-synthetic',
  skill: { id: 'Spark', gemLevel: 20, quality: 0 },
  configuration: {
    id: 'explicit-enemy',
    lightningResistance: {
      baseResistancePercent: 75,
      maximumResistanceMode: 'configured',
      source: { kind: 'scenario', id: 'enemy:base-resistance' },
      exposures: [],
    },
  },
  modifiers: [],
};
function value(result) {
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result.value;
}

test('lightning resistance facts retain exact game IDs, snapshot and an attributed cap/order rule', async () => {
  assert.deepEqual(dataset.resistance.identity, dataset.identity);
  assert.deepEqual(
    dataset.resistance.sourceRows.map(({ table, key, rowIndex }) => [table, key, rowIndex]),
    [
      ['Stats', 'base_reduce_enemy_lightning_resistance_%', 597],
      ['Stats', 'lightning_exposure_on_hit_magnitude', 16084],
    ],
  );
  assert.equal(dataset.resistance.ruleSource.kind, 'external');
  assert.match(dataset.resistance.ruleSource.id, /3dbca446.*CalcOffence/);
  for (const id of [
    'base_reduce_enemy_lightning_resistance_%',
    'lightning_exposure_on_hit_magnitude',
  ]) {
    const missing = structuredClone(fixture);
    missing.tables.Stats = missing.tables.Stats.filter((row) => row.Id !== id);
    assert.equal((await loadSparkDataset(fixtureReader(missing))).ok, false);
    const local = structuredClone(fixture);
    local.tables.Stats.find((row) => row.Id === id).IsLocal = true;
    assert.equal((await loadSparkDataset(fixtureReader(local))).ok, false);
  }
});

test('exposure lowers uncapped resistance before caps, while penetration subtracts after caps', () => {
  const input = structuredClone(basic);
  input.configuration.lightningResistance.baseResistancePercent = 110;
  input.configuration.lightningResistance.exposures = [exposure(-15)];
  input.modifiers = [pen(20)];
  const configured = value(calculateSelectedSkill(input, dataset));
  const stages = configured.resistanceEffects;
  assert.equal(stages.baseResistancePercent, 110);
  assert.equal(stages.exposurePercent, -15);
  assert.equal(stages.uncappedResistancePercent, 95);
  assert.equal(stages.maximumResistancePercent, 90);
  assert.equal(stages.minimumResistancePercent, -200);
  assert.equal(stages.cappedResistancePercent, 90);
  assert.equal(stages.penetrationPercent, 20);
  assert.equal(stages.effectiveResistancePercent, 70);
  assert.equal(stages.damageMultiplier, 1 - 70 / 100);
  assert.equal(configured.hit.increasedDamagePercent, 0);
  assert.equal(configured.hit.modifierContributions.length, 0);
  assert.deepEqual(stages.penetrationContributions, input.modifiers);
  assert.deepEqual(stages.exposureContributions, input.configuration.lightningResistance.exposures);
  assert.deepEqual(stages.configurationSource, input.configuration.lightningResistance.source);
  input.configuration.lightningResistance.maximumResistanceMode = 'default75';
  const defaultCap = value(calculateSelectedSkill(input, dataset));
  assert.equal(defaultCap.resistanceEffects.maximumResistancePercent, 75);
  assert.equal(defaultCap.resistanceEffects.cappedResistancePercent, 75);
  assert.equal(defaultCap.resistanceEffects.effectiveResistancePercent, 55);
  assert.equal(
    defaultCap.hit.nonCriticalHitAfterResistance.mean,
    defaultCap.hit.nonCriticalHitBeforeResistance.mean * (1 - 55 / 100),
  );
});

test('only the strongest active exposure applies; ties, disabled and zero sources retain provenance', () => {
  const input = structuredClone(basic);
  input.configuration.lightningResistance.exposures = [
    exposure(-10, true, 'weak'),
    exposure(-25, true, 'strong-a'),
    exposure(-25, true, 'strong-b'),
    exposure(-50, false, 'disabled'),
    exposure(0, true, 'zero'),
  ];
  const before = structuredClone(input);
  const result = value(calculateSelectedSkill(input, dataset));
  assert.equal(result.resistanceEffects.exposurePercent, -25);
  assert.equal(result.resistanceEffects.uncappedResistancePercent, 50);
  assert.deepEqual(result.resistanceEffects.selectedExposureIndices, [1, 2]);
  assert.deepEqual(
    result.resistanceEffects.exposureContributions,
    before.configuration.lightningResistance.exposures,
  );
  assert.deepEqual(input, before);
  input.configuration.lightningResistance.source.id = 'host-mutated';
  input.configuration.lightningResistance.exposures[1].source.id = 'host-mutated';
  assert.equal(result.resistanceEffects.configurationSource.id, 'enemy:base-resistance');
  assert.equal(result.resistanceEffects.exposureContributions[1].source.id, 'strong-a');
  assert.equal(result.configuration.lightningResistance.exposures[1].source.id, 'strong-a');
});

test('the -200 floor precedes penetration, and normal/critical hits use the same resolved resistance', () => {
  const input = structuredClone(basic);
  input.configuration.lightningResistance.baseResistancePercent = -190;
  input.configuration.lightningResistance.exposures = [exposure(-30)];
  input.configuration.criticalStrikeMode = 'average';
  input.configuration.ailmentMode = 'excluded';
  input.modifiers = [
    pen(10),
    pen(10, 6),
    {
      statId: 'base_critical_strike_multiplier_+',
      value: 50,
      source: { kind: 'item', id: 'robe:1', line: 7 },
    },
  ];
  const result = value(calculateSelectedSkill(input, dataset));
  assert.equal(result.resistanceEffects.uncappedResistancePercent, -220);
  assert.equal(result.resistanceEffects.cappedResistancePercent, -200);
  assert.equal(result.resistanceEffects.effectiveResistancePercent, -220);
  assert.equal(result.resistanceEffects.damageMultiplier, 3.2);
  assert.equal(result.hit.effectiveLightningResistancePercent, -220);
  assert.equal(
    result.hit.nonCriticalHitAfterResistance.mean,
    result.hit.nonCriticalHitBeforeResistance.mean * 3.2,
  );
  assert.equal(
    result.criticalEffects.criticalHitAfterResistance.mean,
    result.criticalEffects.criticalHitBeforeResistance.mean * 3.2,
  );
  assert.equal(
    result.criticalEffects.expectedHitMeanAfterResistance,
    result.hit.nonCriticalHitAfterResistance.mean * 0.94 +
      result.criticalEffects.criticalHitAfterResistance.mean * 0.06,
  );
  assert.equal(result.resistanceEffects.penetrationContributions.length, 2);
  const zero = value(
    calculateSelectedSkill(
      {
        ...input,
        modifiers: [
          ...input.modifiers,
          { statId: 'damage_+%', value: -100, source: { kind: 'item', id: 'zero' } },
        ],
      },
      dataset,
    ),
  );
  assert.equal(zero.combinedDps, 0);
  assert.equal(zero.resistanceEffects.effectiveResistancePercent, -220);
});

test('legacy already-effective inputs retain their meaning and reject ambiguous new mechanics', () => {
  const legacy = {
    ...basic,
    configuration: { id: 'legacy', effectiveLightningResistancePercent: 25 },
  };
  const result = value(calculateSelectedSkill(legacy, dataset));
  assert.equal(result.resistanceEffects.profile, 'effective');
  assert.equal(result.resistanceEffects.maximumResistancePercent, null);
  assert.equal(result.resistanceEffects.minimumResistancePercent, null);
  assert.equal(result.resistanceEffects.effectiveResistancePercent, 25);
  assert.equal(calculateSelectedSkill({ ...legacy, modifiers: [pen(0)] }, dataset).ok, false);
  assert.equal(
    calculateSelectedSkill(
      {
        ...legacy,
        configuration: {
          ...legacy.configuration,
          lightningResistance: basic.configuration.lightningResistance,
        },
      },
      dataset,
    ).ok,
    false,
  );
  assert.equal(
    calculateSpark(
      {
        identity: dataset.identity,
        gemLevel: 20,
        effectiveLightningResistancePercent: 0,
        modifiers: [pen(20)],
      },
      dataset,
    ).ok,
    false,
  );
  const noFacts = structuredClone(dataset);
  delete noFacts.resistance;
  assert.equal(calculateSelectedSkill(legacy, noFacts).ok, true);
  assert.equal(calculateSelectedSkill(basic, noFacts).ok, false);
});

test('unsupported resistance contexts and missing facts fail with no successful placeholder', () => {
  const inputs = [
    {
      ...basic,
      configuration: Object.assign(Object.create({ lightningResistance: null }), {
        id: 'legacy-inherited-null',
        effectiveLightningResistancePercent: 0,
      }),
    },
    {
      ...basic,
      configuration: Object.assign(
        Object.create({ lightningResistance: basic.configuration.lightningResistance }),
        { id: 'legacy-inherited-raw', effectiveLightningResistancePercent: 0 },
      ),
    },
    {
      ...basic,
      configuration: Object.assign(Object.create({ effectiveLightningResistancePercent: 0 }), {
        id: 'raw-inherited-effective',
        lightningResistance: basic.configuration.lightningResistance,
      }),
    },
    { ...basic, modifiers: [pen(-1)] },
    { ...basic, modifiers: [pen(1.5)] },
    { ...basic, modifiers: [pen(201)] },
    { ...basic, modifiers: [pen(200), pen(1)] },
    { ...basic, modifiers: [{ ...pen(20), conditions: ['on-critical-strike'] }] },
  ];
  for (const mutate of [
    (raw) => {
      raw.baseResistancePercent = 1001;
    },
    (raw) => {
      raw.baseResistancePercent = 75.5;
    },
    (raw) => {
      delete raw.maximumResistanceMode;
    },
    (raw) => {
      raw.maximumResistancePercent = 50;
    },
    (raw) => {
      raw.source = Object.create(raw.source);
    },
    (raw) => {
      raw.exposures = [exposure(1)];
    },
    (raw) => {
      raw.exposures = [exposure(-101)];
    },
    (raw) => {
      raw.exposures = [exposure(-10.5)];
    },
    (raw) => {
      raw.exposures = Array(9).fill(exposure(-10));
    },
    (raw) => {
      raw.exposures = Array(1);
    },
    (raw) => {
      raw.exposures = [{ ...exposure(-10), conditions: ['on-hit'] }];
    },
    (raw) => {
      raw.exposures = [
        { ...exposure(-10), statId: 'base_inflict_lightning_exposure_on_hit_%_chance' },
      ];
    },
  ]) {
    const input = structuredClone(basic);
    mutate(input.configuration.lightningResistance);
    inputs.push(input);
  }
  for (const input of inputs) {
    const result = calculateSelectedSkill(input, dataset);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal('value' in result, false);
  }
  for (const mutate of [
    (data) => {
      data.resistance.identity.snapshotId = 'other';
    },
    (data) => {
      delete data.resistance.sourceRows[0];
    },
    (data) => {
      data.resistance.ruleSource.cycle = data;
    },
    (data) => {
      data.resistance.sourceRows[0] = Object.create(data.resistance.sourceRows[0]);
    },
  ]) {
    const data = structuredClone(dataset);
    mutate(data);
    const result = calculateSelectedSkill(basic, data);
    assert.equal(result.ok, false);
    assert.equal('value' in result, false);
  }
});
