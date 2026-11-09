import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { calculateSelectedSkill, loadSparkDataset } from '@exile-engine/poe1';
import { fixtureReader } from '../../core/test/fixture-reader.mjs';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/spark-client.json', import.meta.url), 'utf8'),
);
function value(result) {
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result.value;
}
const dataset = value(await loadSparkDataset(fixtureReader(fixture)));
const basic = {
  identity: dataset.identity,
  buildId: 'configured-shock-synthetic',
  skill: { id: 'Spark', gemLevel: 20, quality: 0 },
  configuration: {
    id: 'explicit-enemy',
    effectiveLightningResistancePercent: 25,
    criticalStrikeMode: 'average',
    ailmentMode: 'configured-shock',
    shock: {
      magnitudePercent: 20,
      uptimePercent: 50,
      source: {
        kind: 'scenario',
        id: 'external-shock',
        label: 'Fixed 20%, half the counted casts',
        line: 1,
      },
    },
  },
  modifiers: [],
};

test('configured shock facts separate exact client vocabulary, scenario provenance and pinned formula', async () => {
  assert.deepEqual(dataset.shock.identity, dataset.identity);
  assert.deepEqual(dataset.shock.sourceRows, [
    { table: 'Stats', key: 'base_damage_taken_+%_from_shock', rowIndex: 16700 },
  ]);
  assert.equal(dataset.shock.ruleSource.kind, 'external');
  assert.match(dataset.shock.ruleSource.id, /3dbca446.*CalcPerform.*CalcOffence/);
  for (const invalid of ['missing', 'local', 'wrong-id']) {
    const changed = structuredClone(fixture);
    const row = changed.tables.Stats.find((row) => row._index === 16700);
    if (invalid === 'missing') changed.tables.Stats.splice(changed.tables.Stats.indexOf(row), 1);
    if (invalid === 'local') row.IsLocal = true;
    if (invalid === 'wrong-id') row.Id = 'shock_effect_+%';
    const result = await loadSparkDataset(fixtureReader(changed));
    assert.equal(result.ok, false, invalid);
    assert.equal('value' in result, false);
  }
});

test('shock weights explicit enemy states after resistance for both normal and critical damage', () => {
  const input = structuredClone(basic);
  input.skill.supports = [
    {
      id: 'SupportControlledDestruction',
      gemLevel: 20,
      quality: 0,
      enabled: true,
      source: { kind: 'skill', id: 'support:1' },
    },
  ];
  input.modifiers = [
    {
      statId: 'base_critical_strike_multiplier_+',
      value: 50,
      source: { kind: 'item', id: 'robe:1', line: 5 },
    },
  ];
  const unshockedInput = structuredClone(input);
  delete unshockedInput.configuration.shock;
  unshockedInput.configuration.ailmentMode = 'excluded';
  const unshocked = value(calculateSelectedSkill(unshockedInput, dataset));
  const result = value(calculateSelectedSkill(input, dataset));
  const shock = result.shockEffects;
  assert.deepEqual(result.hit, unshocked.hit);
  assert.deepEqual(result.criticalEffects, unshocked.criticalEffects);
  assert.equal(result.criticalEffects.chancePercent, 1.2);
  assert.equal(shock.shockedDamageMultiplier, 1.2);
  assert.equal(shock.averageDamageMultiplier, 1.1);
  assert.equal(
    shock.unshockedHitMeanAfterResistance,
    result.criticalEffects.expectedHitMeanAfterResistance,
  );
  assert.equal(shock.shockedHitMeanAfterResistance, shock.unshockedHitMeanAfterResistance * 1.2);
  assert.equal(shock.normalHitMeanAfterShock, result.hit.nonCriticalHitAfterResistance.mean * 1.1);
  assert.equal(
    shock.criticalHitMeanAfterShock,
    result.criticalEffects.criticalHitAfterResistance.mean * 1.1,
  );
  assert.equal(shock.expectedHitMeanAfterShock, shock.unshockedHitMeanAfterResistance * 1.1);
  assert.equal(result.hitDps, shock.expectedHitMeanAfterShock * result.hit.castsPerSecond);
  assert.equal(result.combinedDps, result.hitDps);
  assert.equal(result.hitsPerCast, 1);
  assert.deepEqual(result.includedDamage, ['lightning-hit']);
  assert.deepEqual(shock.contributions, [
    {
      statId: 'base_damage_taken_+%_from_shock',
      value: 20,
      source: input.configuration.shock.source,
      uptimePercent: 50,
      operation: 'increased-damage-taken',
    },
  ]);
  input.configuration.shock.source.label = 'mutated host input';
  assert.equal(shock.contributions[0].source.label, 'Fixed 20%, half the counted casts');
  assert.equal(result.configuration.shock.source.label, 'Fixed 20%, half the counted casts');
});

test('zero uptime, zero magnitude and no damage retain the explicit shock scenario', () => {
  for (const [magnitude, uptime] of [
    [0, 100],
    [20, 0],
    [1, 100],
    [50, 100],
  ]) {
    const input = structuredClone(basic);
    input.configuration.shock.magnitudePercent = magnitude;
    input.configuration.shock.uptimePercent = uptime;
    const result = value(calculateSelectedSkill(input, dataset));
    assert.equal(result.shockEffects.mode, 'configured');
    assert.equal(
      result.shockEffects.averageDamageMultiplier,
      1 + (magnitude / 100) * (uptime / 100),
    );
    assert.equal(result.shockEffects.contributions.length, 1);
    assert.equal(result.shockEffects.contributions[0].value, magnitude);
    input.modifiers = [
      { statId: 'damage_+%', value: -100, source: { kind: 'item', id: 'zero-damage' } },
    ];
    assert.equal(value(calculateSelectedSkill(input, dataset)).combinedDps, 0);
  }
  const absent = structuredClone(basic);
  delete absent.configuration.shock;
  absent.configuration.ailmentMode = 'excluded';
  const result = value(calculateSelectedSkill(absent, dataset));
  assert.equal(result.shockEffects.mode, 'excluded');
  assert.equal(result.shockEffects.averageDamageMultiplier, 1);
  assert.deepEqual(result.shockEffects.contributions, []);
});

test('missing, ambiguous and unsupported shock mechanics fail instead of guessing', () => {
  const shocks = [
    null,
    undefined,
    {},
    { magnitudePercent: 20 },
    ...[-1, 51, 20.5, NaN, Infinity].map((magnitudePercent) => ({
      ...basic.configuration.shock,
      magnitudePercent,
    })),
    ...[-1, 101, 50.5, NaN, Infinity].map((uptimePercent) => ({
      ...basic.configuration.shock,
      uptimePercent,
    })),
    { ...basic.configuration.shock, source: { kind: 'item', id: 'wrong-context' } },
    { ...basic.configuration.shock, source: { kind: 'scenario', id: 'x', line: 0 } },
    { ...basic.configuration.shock, source: { kind: 'scenario', id: 'x', chance: 100 } },
    { ...basic.configuration.shock, chancePercent: 100 },
    { ...basic.configuration.shock, effectPercent: 50 },
    Object.create(basic.configuration.shock),
  ];
  for (const shock of shocks) {
    const input = structuredClone(basic);
    input.configuration.shock = shock;
    const result = calculateSelectedSkill(input, dataset);
    assert.equal(result.ok, false);
    assert.equal('value' in result, false);
  }
  for (const ailmentMode of [undefined, 'excluded', 'automatic-shock']) {
    const input = structuredClone(basic);
    input.configuration.ailmentMode = ailmentMode;
    assert.equal(calculateSelectedSkill(input, dataset).ok, false);
  }
  for (const statId of [
    'base_damage_taken_+%_from_shock',
    'shock_effect_+%',
    'base_chance_to_shock_%',
  ]) {
    const input = structuredClone(basic);
    input.modifiers = [{ statId, value: 20, source: { kind: 'item', id: 'unsupported' } }];
    assert.equal(calculateSelectedSkill(input, dataset).ok, false);
  }
  const missing = structuredClone(dataset);
  delete missing.shock;
  assert.equal(calculateSelectedSkill(basic, missing).ok, false);
  for (const mutation of [
    (data) => {
      data.shock.identity.snapshotId += '-other';
    },
    (data) => {
      data.shock.ruleSource.id = 'unreviewed';
    },
    (data) => {
      data.shock.sourceRows[0].key = 'shock_effect_+%';
    },
    (data) => {
      data.shock.sourceRows = Array(1);
    },
    (data) => {
      data.shock.extra = data;
    },
  ]) {
    const data = structuredClone(dataset);
    mutation(data);
    assert.equal(calculateSelectedSkill(basic, data).ok, false);
  }
});
