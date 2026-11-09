import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { calculateSpark, loadSparkDataset } from '@exile-engine/poe2';
import { fixtureReader } from '../../core/test/fixture-reader.mjs';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/spark-client.json', import.meta.url), 'utf8'),
);
const reader = fixtureReader(fixture);
const loaded = await loadSparkDataset(reader);
assert.equal(loaded.ok, true, JSON.stringify(loaded.diagnostics));
const dataset = loaded.value;
const basic = { identity: reader.identity, gemLevel: 20, effectiveLightningResistancePercent: 0 };

test('PoE2 Base Spark takes exact resolved values from its own statset', () => {
  for (const [gemLevel, min, max] of [
    [1, 1, 10],
    [20, 11, 216],
    [40, 103, 1949],
  ]) {
    const result = calculateSpark({ ...basic, gemLevel }, dataset);
    assert.equal(result.ok, true);
    assert.deepEqual(result.value.baseLightningDamage, { min, max, mean: (min + max) / 2 });
    assert.equal(result.value.castTimeSeconds, 0.7);
    assert.equal(result.value.skillId, 'SparkPlayer');
  }
});

test('ordinary PoE2 quality reports projectile speed without pretending it grants extra hit damage', () => {
  const result = calculateSpark({ ...basic, quality: 20 }, dataset);
  assert.equal(result.ok, true);
  assert.equal(result.value.qualityStats[0].statId, 'base_projectile_speed_+%');
  assert.equal(result.value.qualityStats[0].value, 30);
  assert.deepEqual(result.value.nonCriticalHitBeforeResistance, result.value.baseLightningDamage);
});

test('PoE2 duplicates retain attribution and negative effective resistance is explicit', () => {
  const result = calculateSpark(
    {
      ...basic,
      effectiveLightningResistancePercent: -50,
      modifiers: [
        { statId: 'spell_damage_+%', value: 20, source: { kind: 'item', id: 'left-wand' } },
        { statId: 'spell_damage_+%', value: 30, source: { kind: 'item', id: 'right-wand' } },
      ],
    },
    dataset,
  );
  assert.equal(result.ok, true);
  assert.equal(result.value.increasedDamagePercent, 50);
  assert.equal(result.value.nonCriticalHitAfterResistance.min, 24.75);
  assert.equal(result.value.nonCriticalHitAfterResistance.max, 486);
  assert.equal(result.value.modifierContributions.length, 2);
});

test('PoE2 rejects Cold-Infused, supports and cross-game data', () => {
  for (const changes of [
    { statSet: 'cold-infused' },
    { variant: 'triggered' },
    { supports: ['Controlled Destruction'] },
    { identity: { ...reader.identity, game: 'poe1' } },
  ]) {
    assert.equal(calculateSpark({ ...basic, ...changes }, dataset).ok, false);
  }
});

test('PoE2 normalization fails if the skill points at another primary statset', async () => {
  const changed = structuredClone(fixture);
  changed.tables.GrantedEffectStatSets[0].Id = 'SparkColdInfusedPlayer';
  assert.equal((await loadSparkDataset(fixtureReader(changed))).ok, false);
});
