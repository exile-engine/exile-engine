import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { calculateSelectedSkill, loadSparkDataset } from '@exile-engine/poe1';
import { fixtureReader } from '../../core/test/fixture-reader.mjs';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/spark-client.json', import.meta.url), 'utf8'),
);
const dataset = (await loadSparkDataset(fixtureReader(fixture))).value;
const input = {
  identity: dataset.identity,
  buildId: 'synthetic-selected-spark',
  skill: { id: 'Spark', gemLevel: 20, quality: 0 },
  configuration: { id: 'normal-enemy-0', effectiveLightningResistancePercent: 0 },
  modifiers: [],
};
const mod = (statId, value) => ({
  statId,
  value,
  source: { kind: 'item', id: 'body-armour:1', line: 6 },
});

test('selected skill counts one noncritical lightning hit per cast and preserves identities', () => {
  const result = calculateSelectedSkill(input, dataset);
  assert.equal(result.ok, true);
  assert.equal(result.value.metric, 'selected-skill-hit-combined-dps');
  assert.deepEqual(result.value.identity, input.identity);
  assert.equal(result.value.buildId, input.buildId);
  assert.deepEqual(result.value.configuration, input.configuration);
  assert.equal(result.value.hitsPerCast, 1);
  assert.equal(result.value.hitsPerSecond, result.value.hit.castsPerSecond);
  assert.equal(result.value.hitDps, 1043.5 / 0.6);
  assert.equal(result.value.combinedDps, result.value.hitDps);
  assert.deepEqual(result.value.includedDamage, ['lightning-hit']);
  assert.equal('fullDps' in result.value, false);
  const quality = calculateSelectedSkill(
    { ...input, skill: { ...input.skill, quality: 20 } },
    dataset,
  );
  assert.equal(quality.value.combinedDps, result.value.combinedDps);
});

test('selected rules round hit endpoints before resistance and rounded speed before tick cap', () => {
  const result = calculateSelectedSkill(
    {
      ...input,
      configuration: { id: 'resisted', effectiveLightningResistancePercent: 25 },
      modifiers: [mod('spell_damage_+%', 25), mod('base_cast_speed_+%', 12.345)],
    },
    dataset,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.hit.nonCriticalHitBeforeResistance, {
    min: 130,
    max: 2479,
    mean: 1304.5,
  });
  assert.equal(result.value.hit.nonCriticalHitAfterResistance.mean, 978.375);
  assert.equal(result.value.hit.castsPerSecond, 1.12 / 0.6);
  assert.equal(result.value.combinedDps, 978.375 * (1.12 / 0.6));
  const capped = calculateSelectedSkill(
    { ...input, modifiers: [mod('base_cast_speed_+%', 10000)] },
    dataset,
  );
  assert.equal(capped.value.hit.castsPerSecond, 1 / 0.033);
  assert.equal(capped.value.hit.castTimeSeconds, 0.033);
});

test('supported zero damage succeeds while missing or unsupported data has no calculation', () => {
  const zero = calculateSelectedSkill({ ...input, modifiers: [mod('damage_+%', -100)] }, dataset);
  assert.equal(zero.ok, true);
  assert.equal(zero.value.combinedDps, 0);
  for (const changed of [
    null,
    { ...input, configuration: undefined },
    { ...input, configuration: { id: 'missing-resistance' } },
    { ...input, configuration: { ...input.configuration, shock: 50 } },
    {
      ...input,
      configuration: { ...input.configuration, effectiveLightningResistancePercent: 100 },
    },
    { ...input, identity: { ...input.identity, game: 'poe2' } },
    { ...input, identity: { ...input.identity, snapshotId: 'another-snapshot' } },
    { ...input, skill: { ...input.skill, supports: ['Added Lightning Damage'] } },
    { ...input, modifiers: [mod('damage_+%', -101)] },
    { ...input, modifiers: [mod('base_cast_speed_+%', -99.9)] },
    { ...input, modifiers: [{ ...mod('spell_damage_+%', 20), conditions: ['on-low-life'] }] },
    { ...input, modifiers: [mod('critical_strike_chance_+%', 10)] },
    { ...input, modifiers: [{ ...mod('damage_+%', 10), source: null }] },
  ]) {
    const result = calculateSelectedSkill(changed, dataset);
    assert.equal(result.ok, false, JSON.stringify(changed));
    assert.equal('value' in result, false);
  }
});
