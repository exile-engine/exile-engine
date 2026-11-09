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
const added = (min, max, line = 7) => ({
  statIds: ['spell_minimum_added_lightning_damage', 'spell_maximum_added_lightning_damage'],
  values: [min, max],
  source: { kind: 'item', id: 'body-armour:1', line },
});

test('ordered added-lightning groups retain raw provenance and scale before increases and rounding', () => {
  const groups = [added(1, 2), added(0, 0, 8)];
  const before = structuredClone(groups);
  const result = calculateSelectedSkill(
    { ...input, modifiers: [mod('spell_damage_+%', 25)], addedLightningDamage: groups },
    dataset,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.hit.baseLightningDamage, { min: 104, max: 1983, mean: 1043.5 });
  assert.deepEqual(result.value.addedLightningDamage, {
    raw: { min: 1, max: 2, mean: 1.5 },
    effectiveness: 1.9,
    effective: { min: 1.9, max: 3.8, mean: (1.9 + 3.8) / 2 },
    combinedBase: { min: 105.9, max: 1986.8, mean: (105.9 + 1986.8) / 2 },
    contributions: groups,
  });
  assert.deepEqual(result.value.hit.nonCriticalHitBeforeResistance, {
    min: 132,
    max: 2484,
    mean: 1308,
  });
  assert.equal(result.value.combinedDps, 2180);
  assert.deepEqual(groups, before);
  groups[0].values[0] = 99;
  assert.equal(result.value.addedLightningDamage.contributions[0].values[0], 1);
  assert.ok(
    result.value.hit.sourceRows.some(
      (row) => row.table === 'Stats' && row.key === 'spell_minimum_added_lightning_damage',
    ),
  );
  const zero = calculateSelectedSkill(
    { ...input, modifiers: [mod('damage_+%', -100)], addedLightningDamage: before },
    dataset,
  );
  assert.equal(zero.ok, true);
  assert.equal(zero.value.combinedDps, 0);
  assert.deepEqual(zero.value.addedLightningDamage.contributions, before);
});

test('invalid or unsupported flat ranges never become a complete calculation', () => {
  const candidates = [
    null,
    [null],
    [added(-1, 2)],
    [added(3, 2)],
    [added(1.5, 2)],
    [added(0, Infinity)],
    [added(0, Number.MAX_SAFE_INTEGER + 1)],
    [added(0, Number.MAX_SAFE_INTEGER), added(0, 1)],
    [
      {
        ...added(1, 2),
        statIds: ['spell_maximum_added_lightning_damage', 'spell_minimum_added_lightning_damage'],
      },
    ],
    [
      {
        ...added(1, 2),
        statIds: ['global_minimum_added_lightning_damage', 'global_maximum_added_lightning_damage'],
      },
    ],
    [{ ...added(1, 2), values: [1] }],
    [{ ...added(1, 2), source: null }],
    [{ ...added(1, 2), conditions: ['on-low-life'] }],
    [{ ...added(1, 2), scope: 'local' }],
    [{ ...added(1, 2), more: true }],
    Array(1001).fill(added(0, 0)),
  ];
  for (const groups of candidates) {
    const result = calculateSelectedSkill({ ...input, addedLightningDamage: groups }, dataset);
    assert.equal(result.ok, false, JSON.stringify(groups));
    assert.equal('value' in result, false);
  }
  assert.equal(
    calculateSelectedSkill(
      { ...input, modifiers: [mod('spell_minimum_added_lightning_damage', 10)] },
      dataset,
    ).ok,
    false,
  );
  for (const effectiveness of [undefined, -1, NaN, Infinity]) {
    const malformed = structuredClone(dataset);
    malformed.levels[19].addedDamageEffectiveness = effectiveness;
    assert.equal(
      calculateSelectedSkill({ ...input, addedLightningDamage: [added(1, 2)] }, malformed).ok,
      false,
    );
  }
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
