import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { calculateSpark, loadSparkDataset } from '@exile-engine/poe1';
import { fixtureReader } from '../../core/test/fixture-reader.mjs';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/spark-client.json', import.meta.url), 'utf8'),
);
const reader = fixtureReader(fixture);
const loaded = await loadSparkDataset(reader);
assert.equal(loaded.ok, true, JSON.stringify(loaded.diagnostics));
const dataset = loaded.value;
const basic = { identity: reader.identity, gemLevel: 20, effectiveLightningResistancePercent: 0 };
const modifier = (statId, value, more = {}) => ({
  statId,
  value,
  source: { kind: 'item', id: 'wand', line: 7 },
  ...more,
});

test('PoE1 added-damage effectiveness is normalized from exact source rows with provenance', async () => {
  for (const level of dataset.levels) {
    const source = fixture.tables.GrantedEffectStatSetsPerLevel.find(
      (row) => row.GemLevel === level.gemLevel,
    );
    assert.equal(source.DamageEffectiveness, 9000);
    assert.equal(level.addedDamageEffectiveness, 1 + source.DamageEffectiveness / 10000);
    assert.ok(
      level.sourceRows.some(
        (row) => row.table === 'GrantedEffectStatSetsPerLevel' && row.rowIndex === source._index,
      ),
    );
  }
  const changed = structuredClone(fixture);
  changed.tables.GrantedEffectStatSetsPerLevel[0].DamageEffectiveness = 0;
  const loaded = await loadSparkDataset(fixtureReader(changed));
  assert.equal(loaded.ok, true);
  assert.equal(loaded.value.levels[0].addedDamageEffectiveness, 1);
  for (const value of [undefined, NaN, Infinity, -10001, 1.5]) {
    const invalid = structuredClone(fixture);
    invalid.tables.GrantedEffectStatSetsPerLevel[0].DamageEffectiveness = value;
    assert.equal((await loadSparkDataset(fixtureReader(invalid))).ok, false);
  }
  const missing = structuredClone(fixture);
  missing.tables.Stats = missing.tables.Stats.filter(
    (row) => row.Id !== 'spell_maximum_added_lightning_damage',
  );
  assert.equal((await loadSparkDataset(fixtureReader(missing))).ok, false);
});

test('PoE1 client-resolved Spark ranges and cast time match recorded client rows', () => {
  for (const [gemLevel, min, max] of [
    [1, 1, 28],
    [20, 104, 1983],
    [40, 382, 7250],
  ]) {
    const result = calculateSpark({ ...basic, gemLevel }, dataset);
    assert.equal(result.ok, true);
    assert.deepEqual(result.value.baseLightningDamage, { min, max, mean: (min + max) / 2 });
    assert.equal(result.value.castTimeSeconds, 0.6);
    assert.equal(result.value.mode, 'normal-base-noncritical-single-hit');
    assert.equal('dps' in result.value, false);
  }
});

test('PoE1 resolved client values independently cross-check the pinned coefficient formula', () => {
  // Formula reference only: PoB 3dbca446 CalcTools.lua:200-215 and Misc.lua:30-31.
  // Golden authority is the original-client BaseResolvedValues, not executed PoB.
  const set = fixture.tables.GrantedEffectStatSets[0];
  for (const row of fixture.tables.GrantedEffectStatSetsPerLevel) {
    const level = row.PlayerLevelReq;
    const scale =
      (3.885209 + 0.360246 * (level - 1)) *
      set.BaseEffectiveness *
      (1 + set.IncrementalEffectiveness) ** (level - 1);
    const derived = row.FloatStatsValues.map((value) => Math.floor(scale * value + 0.5));
    assert.deepEqual(derived, row.BaseResolvedValues, `Gem level ${row.GemLevel}`);
  }
});

test('damage increases combine additively, resistance follows, cast speed stays separate', () => {
  const contributions = [
    modifier('damage_+%', 10),
    modifier('spell_damage_+%', 20),
    modifier('lightning_damage_+%', 30),
    modifier('projectile_damage_+%', 40),
    modifier('base_cast_speed_+%', 25),
  ];
  const before = structuredClone(contributions);
  const result = calculateSpark(
    { ...basic, modifiers: contributions, effectiveLightningResistancePercent: 25 },
    dataset,
  );
  assert.equal(result.ok, true);
  assert.equal(result.value.increasedDamagePercent, 100);
  assert.equal(result.value.increasedCastSpeedPercent, 25);
  assert.equal(result.value.nonCriticalHitBeforeResistance.min, 208);
  assert.equal(result.value.nonCriticalHitBeforeResistance.max, 3966);
  assert.equal(result.value.nonCriticalHitAfterResistance.min, 156);
  assert.equal(result.value.nonCriticalHitAfterResistance.max, 2974.5);
  assert.equal(result.value.castTimeSeconds, 0.48);
  assert.deepEqual(contributions, before);
  assert.equal(result.value.modifierContributions.length, 5);
  assert.ok(result.value.sourceRows.some((row) => row.table === 'GrantedEffectStatSetsPerLevel'));
});

test('ordinary quality reports projectiles and does not multiply single-hit damage', () => {
  const result = calculateSpark({ ...basic, quality: 20 }, dataset);
  assert.equal(result.ok, true);
  assert.equal(result.value.qualityStats[0].statId, 'base_number_of_projectiles');
  assert.equal(result.value.qualityStats[0].value, 2);
  assert.deepEqual(result.value.nonCriticalHitBeforeResistance, result.value.baseLightningDamage);
});

test('strict calculation boundaries reject unsupported mechanics instead of ignoring them', () => {
  const invalid = [
    { identity: { ...reader.identity, game: 'poe2' } },
    { identity: { ...reader.identity, build: 'different' } },
    { identity: { ...reader.identity, snapshotId: 'different' } },
    { gemLevel: 0 },
    { gemLevel: 41 },
    { gemLevel: 2.5 },
    { quality: 101 },
    { variant: 'vaal' },
    { statSet: 'maximum-hits' },
    { supports: ['Added Lightning'] },
    { criticalChance: 10 },
    { effectiveLightningResistancePercent: undefined },
    { effectiveLightningResistancePercent: NaN },
    { modifiers: [modifier('spell_minimum_added_lightning_damage', 1)] },
    { modifiers: [modifier('spell_damage_+%', 10, { scope: 'local' })] },
    { modifiers: [modifier('spell_damage_+%', 10, { conditions: ['on-low-life'] })] },
    { modifiers: [modifier('spell_damage_+%', Infinity)] },
    { modifiers: [modifier('spell_damage_+%', 10, { more: true })] },
    { modifiers: [modifier('base_cast_speed_+%', -100)] },
  ];
  for (const changes of invalid) {
    const result = calculateSpark({ ...basic, ...changes }, dataset);
    assert.equal(result.ok, false, JSON.stringify(changes));
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.severity === 'error'));
  }
});

test('malformed normalized datasets return diagnostics rather than throwing or emitting NaN', () => {
  for (const mutate of [
    (data) => {
      data.levels[0] = null;
    },
    (data) => {
      data.levels[0].sourceRows = null;
    },
    (data) => {
      data.levels[1].gemLevel = data.levels[0].gemLevel;
    },
    (data) => {
      data.qualityStats[0] = null;
    },
    (data) => {
      data.qualityStats[0].valuePerQuality = Infinity;
    },
    (data) => {
      data.qualityStats[0].valuePerQuality = Number.MAX_VALUE;
    },
    (data) => {
      data.qualityStats[0].sourceRows = null;
    },
  ]) {
    const malformed = structuredClone(dataset);
    mutate(malformed);
    assert.equal(calculateSpark({ ...basic, quality: 20 }, malformed).ok, false);
  }
  assert.equal(calculateSpark(basic, null).ok, false);
});

test('normalization rejects missing or inconsistent client facts atomically', async () => {
  for (const mutate of [
    (fixture) => fixture.tables.GrantedEffectStatSetsPerLevel.pop(),
    (fixture) => fixture.tables.GrantedEffectStatSetsPerLevel[0].BaseResolvedValues.pop(),
    (fixture) =>
      fixture.tables.GrantedEffectStatSetsPerLevel[0].BaseResolvedValues.splice(0, 1, -1),
    (fixture) => fixture.tables.GrantedEffectQualityStats[0].StatsValuesPermille.pop(),
    (fixture) => {
      const damageStat = fixture.tables.Stats.find((stat) => stat.Id === 'damage_+%');
      fixture.tables.GrantedEffectStatSets[0].ConstantStats.push(damageStat._index);
      fixture.tables.GrantedEffectStatSets[0].ConstantStatsValues.push(25);
    },
  ]) {
    const changed = structuredClone(fixture);
    mutate(changed);
    const result = await loadSparkDataset(fixtureReader(changed));
    assert.equal(result.ok, false);
    assert.equal('value' in result, false);
  }
});

test('normalization captures snapshot identity before asynchronous reads', async () => {
  const changing = fixtureReader(fixture);
  const getTable = changing.getTable;
  changing.getTable = async (name) => {
    const rows = await getTable(name);
    changing.identity = { ...changing.identity, snapshotId: 'changed-during-read' };
    return rows;
  };
  const result = await loadSparkDataset(changing);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics[0].message.includes('snapshot changed'));
});
