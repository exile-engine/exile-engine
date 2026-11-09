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
const support = {
  id: 'SupportControlledDestruction',
  gemLevel: 20,
  quality: 0,
  enabled: true,
  source: { kind: 'skill', id: 'spark-group:gem:2' },
};
const basic = {
  identity: dataset.identity,
  buildId: 'critical-synthetic',
  skill: { id: 'Spark', gemLevel: 20, quality: 0 },
  configuration: {
    id: 'explicit-average-no-ailments',
    effectiveLightningResistancePercent: 0,
    criticalStrikeMode: 'average',
    ailmentMode: 'excluded',
  },
  modifiers: [],
};
const mod = (statId, value, line = 5) => ({
  statId,
  value,
  source: { kind: 'item', id: 'robe:1', line },
});
function value(result) {
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result.value;
}

test('critical base chance comes from each client level; base multiplier has an explicit external rule source', async () => {
  for (const level of dataset.levels) {
    const raw = fixture.tables.GrantedEffectStatSetsPerLevel.find(
      (row) => row.StatSet === 948 && row.GemLevel === level.gemLevel,
    );
    assert.equal(raw.SpellCritChance, 600);
    assert.equal(level.baseCriticalStrikeChancePercent, raw.SpellCritChance / 100);
    assert.ok(
      level.sourceRows.some(
        (row) => row.table === 'GrantedEffectStatSetsPerLevel' && row.rowIndex === raw._index,
      ),
    );
  }
  assert.equal(dataset.critical.baseMultiplierPercent, 150);
  assert.equal(dataset.critical.baseMultiplierSource.kind, 'external');
  assert.match(dataset.critical.baseMultiplierSource.id, /3dbca446.*Misc\.lua:89/);
  assert.deepEqual(dataset.critical.identity, dataset.identity);
  assert.deepEqual(
    dataset.critical.sourceRows.map((row) => row.key),
    [
      'critical_strike_chance_+%',
      'spell_critical_strike_chance_+%',
      'base_critical_strike_multiplier_+',
    ],
  );
  const changed = structuredClone(fixture);
  changed.tables.GrantedEffectStatSetsPerLevel.find(
    (row) => row.StatSet === 948 && row.GemLevel === 20,
  ).SpellCritChance = 700;
  assert.equal(
    value(await loadSparkDataset(fixtureReader(changed))).levels[19]
      .baseCriticalStrikeChancePercent,
    7,
  );
  for (const chance of [undefined, -1, NaN, Infinity, 10001, 600.5]) {
    const invalid = structuredClone(fixture);
    invalid.tables.GrantedEffectStatSetsPerLevel.find(
      (row) => row.StatSet === 948 && row.GemLevel === 20,
    ).SpellCritChance = chance;
    assert.equal((await loadSparkDataset(fixtureReader(invalid))).ok, false);
  }
});

test('average critical hit mixes the two explicit hit distributions and preserves modifier provenance', () => {
  const before = structuredClone(basic);
  const result = value(calculateSelectedSkill(basic, dataset));
  assert.equal(result.criticalEffects.baseChancePercent, 6);
  assert.equal(result.criticalEffects.chancePercent, 6);
  assert.equal(result.criticalEffects.criticalMultiplier, 1.5);
  assert.deepEqual(result.criticalEffects.criticalHitBeforeResistance, {
    min: 156,
    max: 2974.5,
    mean: 1565.25,
  });
  assert.equal(
    result.criticalEffects.expectedHitMeanAfterResistance,
    1043.5 * 0.94 + 1565.25 * 0.06,
  );
  assert.equal(
    result.hitDps,
    result.criticalEffects.expectedHitMeanAfterResistance * result.hit.castsPerSecond,
  );
  assert.equal(result.combinedDps, result.hitDps);
  assert.equal(result.hitsPerCast, 1);
  assert.deepEqual(result.includedDamage, ['lightning-hit']);
  assert.deepEqual(basic, before);
  const modifiers = [
    mod('critical_strike_chance_+%', 100),
    mod('spell_critical_strike_chance_+%', 50, 6),
    mod('base_critical_strike_multiplier_+', 50, 7),
    mod('spell_damage_+%', 25, 8),
    mod('base_cast_speed_+%', 25, 9),
  ];
  const mixed = value(calculateSelectedSkill({ ...basic, modifiers }, dataset));
  assert.equal(mixed.hit.increasedDamagePercent, 25);
  assert.equal(mixed.hit.increasedCastSpeedPercent, 25);
  assert.equal(mixed.hit.modifierContributions.length, 2);
  assert.equal(mixed.criticalEffects.increasedChancePercent, 150);
  assert.equal(mixed.criticalEffects.chancePercent, 15);
  assert.equal(mixed.criticalEffects.addedMultiplierPercent, 50);
  assert.equal(mixed.criticalEffects.criticalMultiplier, 2);
  assert.deepEqual(mixed.criticalEffects.modifierContributions, modifiers.slice(0, 3));
  modifiers[0].source.id = 'host-mutation';
  assert.equal(mixed.criticalEffects.modifierContributions[0].source.id, 'robe:1');
});

test('Controlled Destruction less crit precedes rounding and cap; critical endpoints are not rerounded', () => {
  const selected = { ...basic, skill: { ...basic.skill, supports: [support] } };
  const result = value(calculateSelectedSkill(selected, dataset));
  assert.equal(result.criticalEffects.lessChanceMultiplier, 0.2);
  assert.equal(result.criticalEffects.chancePercent, 1.2);
  assert.equal(result.criticalEffects.criticalHitBeforeResistance.min, 217.5);
  assert.equal(
    result.supportEffects.contributions.find(
      (row) => row.operation === 'less-critical-strike-chance',
    ).appliedToSelectedHit,
    true,
  );
  const rounded = value(
    calculateSelectedSkill(
      { ...selected, modifiers: [mod('spell_critical_strike_chance_+%', 17)] },
      dataset,
    ),
  );
  assert.ok(Math.abs(rounded.criticalEffects.unroundedChancePercent - 1.404) < 1e-12);
  assert.equal(rounded.criticalEffects.roundedChancePercent, 1.4);
  assert.equal(rounded.criticalEffects.chancePercent, 1.4);
  const capped = value(
    calculateSelectedSkill(
      { ...selected, modifiers: [mod('critical_strike_chance_+%', 2000)] },
      dataset,
    ),
  );
  assert.equal(capped.criticalEffects.chancePercent, 25.2);
  const disabled = value(
    calculateSelectedSkill(
      {
        ...selected,
        skill: { ...selected.skill, supports: [{ ...support, enabled: false }] },
        modifiers: [mod('critical_strike_chance_+%', 2000)],
      },
      dataset,
    ),
  );
  assert.equal(disabled.criticalEffects.chancePercent, 100);
  const excluded = value(
    calculateSelectedSkill(
      { ...selected, configuration: { ...selected.configuration, criticalStrikeMode: 'disabled' } },
      dataset,
    ),
  );
  assert.equal(excluded.criticalEffects.chancePercent, 0);
  assert.equal(
    excluded.supportEffects.contributions.find(
      (row) => row.operation === 'less-critical-strike-chance',
    ).appliedToSelectedHit,
    false,
  );
  assert.equal(
    excluded.criticalEffects.expectedHitMeanAfterResistance,
    excluded.hit.nonCriticalHitAfterResistance.mean,
  );
});

test('zero chance, zero damage and the one-times multiplier floor stay supported explicit results', () => {
  const zeroChance = value(
    calculateSelectedSkill(
      { ...basic, modifiers: [mod('critical_strike_chance_+%', -100)] },
      dataset,
    ),
  );
  assert.equal(zeroChance.criticalEffects.chancePercent, 0);
  assert.equal(
    zeroChance.criticalEffects.expectedHitMeanAfterResistance,
    zeroChance.hit.nonCriticalHitAfterResistance.mean,
  );
  const floor = value(
    calculateSelectedSkill(
      { ...basic, modifiers: [mod('base_critical_strike_multiplier_+', -100)] },
      dataset,
    ),
  );
  assert.equal(floor.criticalEffects.criticalMultiplier, 1);
  assert.equal(
    floor.criticalEffects.expectedHitMeanAfterResistance,
    floor.hit.nonCriticalHitAfterResistance.mean,
  );
  const zeroDamage = value(
    calculateSelectedSkill(
      {
        ...basic,
        modifiers: [mod('damage_+%', -100), mod('base_critical_strike_multiplier_+', 50)],
      },
      dataset,
    ),
  );
  assert.equal(zeroDamage.combinedDps, 0);
  assert.equal(zeroDamage.criticalEffects.chancePercent, 6);
  assert.deepEqual(zeroDamage.criticalEffects.criticalHitBeforeResistance, {
    min: 0,
    max: 0,
    mean: 0,
  });
});

test('missing policy/facts and unimplemented critical mechanics fail without a successful zero placeholder', () => {
  for (const input of [
    {
      ...basic,
      configuration: {
        id: 'missing-policy',
        effectiveLightningResistancePercent: 0,
        criticalStrikeMode: 'average',
      },
    },
    { ...basic, configuration: { ...basic.configuration, criticalStrikeMode: 'lucky' } },
    { ...basic, configuration: { ...basic.configuration, ailmentMode: 'shock' } },
    { ...basic, configuration: { ...basic.configuration, criticalChanceIsLucky: true } },
    { ...basic, baseCriticalChancePercent: 10 },
    { ...basic, modifiers: [mod('critical_strike_chance_+%', 1.5)] },
    { ...basic, modifiers: [mod('base_critical_strike_multiplier_+', Infinity)] },
    { ...basic, modifiers: [mod('base_critical_strike_multiplier_+', Number.MAX_SAFE_INTEGER)] },
    {
      ...basic,
      modifiers: [
        mod('critical_strike_chance_+%', Number.MAX_SAFE_INTEGER),
        mod('spell_critical_strike_chance_+%', 1),
      ],
    },
    {
      ...basic,
      modifiers: [{ ...mod('critical_strike_chance_+%', 100), conditions: ['on-low-life'] }],
    },
  ]) {
    const result = calculateSelectedSkill(input, dataset);
    assert.equal(result.ok, false);
    assert.equal('value' in result, false);
  }
  for (const mutate of [
    (data) => {
      delete data.critical;
    },
    (data) => {
      data.critical.identity.snapshotId = 'other';
    },
    (data) => {
      data.critical.baseMultiplierPercent = 200;
    },
    (data) => {
      delete data.critical.sourceRows[0];
    },
    (data) => {
      data.levels[19].baseCriticalStrikeChancePercent = undefined;
    },
    (data) => {
      data.critical.baseMultiplierSource.cycle = data;
    },
  ]) {
    const data = structuredClone(dataset);
    mutate(data);
    const result = calculateSelectedSkill(basic, data);
    assert.equal(result.ok, false);
    assert.equal('value' in result, false);
  }
  const old = structuredClone(dataset);
  delete old.critical;
  const disabled = {
    ...basic,
    configuration: { id: 'old-noncritical', effectiveLightningResistancePercent: 0 },
  };
  assert.equal(calculateSelectedSkill(disabled, old).ok, true);
  assert.equal(
    calculateSelectedSkill({ ...disabled, modifiers: [mod('critical_strike_chance_+%', 10)] }, old)
      .ok,
    false,
  );
});

test('unsafe intermediate critical totals reject before cancellation loses authored integer points', () => {
  for (const statId of [
    'critical_strike_chance_+%',
    'spell_critical_strike_chance_+%',
    'base_critical_strike_multiplier_+',
  ]) {
    for (const values of [
      [Number.MAX_SAFE_INTEGER, 2, -Number.MAX_SAFE_INTEGER],
      [-Number.MAX_SAFE_INTEGER, -2, Number.MAX_SAFE_INTEGER],
    ]) {
      const result = calculateSelectedSkill(
        { ...basic, modifiers: values.map((point, index) => mod(statId, point, index + 5)) },
        dataset,
      );
      assert.equal(result.ok, false);
      assert.equal('value' in result, false);
    }
  }
});
