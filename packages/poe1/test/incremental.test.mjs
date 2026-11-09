import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  calculateSelectedSkill,
  createSelectedSkillSession,
  loadSparkDataset,
  planCalculationGraph,
} from '@exile-engine/poe1';
import { fixtureReader } from '../../core/test/fixture-reader.mjs';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/spark-client.json', import.meta.url), 'utf8'),
);
const loaded = await loadSparkDataset(fixtureReader(fixture));
assert.equal(loaded.ok, true, JSON.stringify(loaded.diagnostics));
const dataset = loaded.value;
const modifier = (statId, value, line) => ({
  statId,
  value,
  source: { kind: 'item', id: 'wand-1', line },
});
const added = (min, max, id = 'wand-1', line = 10) => ({
  statIds: ['spell_minimum_added_lightning_damage', 'spell_maximum_added_lightning_damage'],
  values: [min, max],
  source: { kind: 'item', id, line },
});
const support = (gemLevel = 1, enabled = true) => ({
  id: 'SupportControlledDestruction',
  gemLevel,
  quality: 0,
  enabled,
  source: { kind: 'skill', id: 'synthetic-support-1', line: 1 },
});
const fasterCasting = (gemLevel = 1, enabled = true) => ({
  id: 'SupportFasterCasting',
  gemLevel,
  quality: 0,
  enabled,
  source: { kind: 'skill', id: 'synthetic-faster-casting', line: 2 },
});
const exposure = (value = -10, enabled = true, id = 'synthetic-exposure-1') => ({
  statId: 'lightning_exposure_on_hit_magnitude',
  value,
  enabled,
  source: { kind: 'scenario', id, line: 1 },
});
const shock = (magnitudePercent = 20, uptimePercent = 100, id = 'synthetic-shock-1') => ({
  magnitudePercent,
  uptimePercent,
  source: { kind: 'scenario', id, line: 1 },
});
const conductivity = (gemLevel = 1, enabled = true, increasedEffectPercent = 0) => ({
  id: 'Conductivity',
  gemLevel,
  quality: 0,
  enabled,
  increasedEffectPercent,
  source: { kind: 'scenario', id: 'synthetic-conductivity', line: 1 },
  effectSource: { kind: 'scenario', id: 'synthetic-curse-effect', line: 1 },
});
function configuredInput(
  baseResistancePercent = 0,
  exposures = [],
  maximumResistanceMode = 'configured',
) {
  const input = structuredClone(basic);
  delete input.configuration.effectiveLightningResistancePercent;
  input.configuration.lightningResistance = {
    baseResistancePercent,
    maximumResistanceMode,
    source: { kind: 'scenario', id: 'synthetic-enemy-resistance', line: 1 },
    exposures,
  };
  return input;
}
const basic = {
  identity: dataset.identity,
  buildId: 'synthetic-incremental',
  skill: { id: 'Spark', gemLevel: 20, quality: 0, variant: 'normal', statSet: 'base' },
  configuration: { id: 'enemy-1', effectiveLightningResistancePercent: 25 },
  modifiers: [
    modifier('spell_damage_+%', 20, 7),
    modifier('lightning_damage_+%', 30, 8),
    modifier('base_cast_speed_+%', 25, 9),
  ],
};

function value(result) {
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result.value;
}

function checkUpdate(session, input) {
  const report = value(session.recalculate(input));
  assert.deepEqual(report.calculation, value(calculateSelectedSkill(input, dataset)));
  return report;
}

test('incremental item and enemy changes equal full recomputation with selective node reports', () => {
  const input = structuredClone(basic);
  const session = value(createSelectedSkillSession(input, dataset));
  assert.deepEqual(session.current.calculation, value(calculateSelectedSkill(input, dataset)));
  assert.deepEqual(checkUpdate(session, input).recalculated, []);

  input.modifiers[0].value = 40;
  assert.deepEqual(checkUpdate(session, input).recalculated, [
    'damage-increase',
    'damage-before-resistance',
    'damage-after-resistance',
    'critical-effects',
    'shock-effects',
    'selected-skill',
  ]);
  input.configuration.effectiveLightningResistancePercent = -25;
  assert.deepEqual(checkUpdate(session, input).recalculated, [
    'uncapped-resistance',
    'capped-resistance',
    'effective-resistance',
    'resistance-effects',
    'damage-after-resistance',
    'critical-effects',
    'shock-effects',
    'selected-skill',
  ]);
  input.configuration.id = 'enemy-2';
  assert.deepEqual(checkUpdate(session, input).recalculated, [
    'resistance-effects',
    'selected-skill',
  ]);
});

test('applicability sets are replaced when a contribution moves categories or is added/removed', () => {
  const input = structuredClone(basic);
  const session = value(createSelectedSkillSession(input, dataset));
  assert.deepEqual(session.current.dependencies['damage-increase'], ['modifier:0', 'modifier:1']);
  input.modifiers[0].statId = 'base_cast_speed_+%';
  const moved = checkUpdate(session, input);
  assert.deepEqual(moved.dependencies['damage-increase'], ['modifier:1']);
  assert.deepEqual(moved.dependencies['cast-speed-increase'], ['modifier:0', 'modifier:2']);
  assert.ok(moved.recalculated.includes('damage-increase'));
  assert.ok(moved.recalculated.includes('cast-speed-increase'));
  assert.ok(moved.recalculated.includes('cast-rate'));
  assert.ok(!moved.recalculated.includes('base'));
  input.modifiers.push(modifier('projectile_damage_+%', 13, 10));
  assert.ok(checkUpdate(session, input).dependencies['damage-increase'].includes('modifier:3'));
  input.modifiers.splice(1, 1);
  checkUpdate(session, input);
  input.modifiers = [];
  const removed = checkUpdate(session, input);
  assert.deepEqual(removed.dependencies['damage-increase'], []);
  assert.deepEqual(removed.dependencies['cast-speed-increase'], []);
  input.modifiers.push(modifier('spell_damage_+%', -100, 11));
  assert.equal(checkUpdate(session, input).calculation.combinedDps, 0);
});

test('grouped added-lightning edits, membership and provenance match full intermediate traces', () => {
  const input = structuredClone(basic);
  input.addedLightningDamage = [added(2, 8), added(3, 12, 'ring-1', 11)];
  const session = value(createSelectedSkillSession(input, dataset));
  assert.deepEqual(session.current.calculation, value(calculateSelectedSkill(input, dataset)));
  assert.deepEqual(session.current.calculation.addedLightningDamage.raw, {
    min: 5,
    max: 20,
    mean: 12.5,
  });
  const effectiveness = dataset.levels.find(
    (level) => level.gemLevel === input.skill.gemLevel,
  ).addedDamageEffectiveness;
  assert.equal(session.current.calculation.addedLightningDamage.effectiveness, effectiveness);
  assert.deepEqual(session.current.dependencies['added-lightning'], [
    'added-lightning:0',
    'added-lightning:1',
  ]);

  input.addedLightningDamage[0].values = [4, 10];
  const changed = checkUpdate(session, input);
  assert.deepEqual(changed.recalculated, [
    'added-lightning',
    'effective-added-lightning',
    'combined-base',
    'damage-before-resistance',
    'damage-after-resistance',
    'critical-effects',
    'shock-effects',
    'selected-skill',
  ]);
  assert.ok(!changed.recalculated.includes('damage-increase'));
  assert.ok(!changed.recalculated.includes('cast-rate'));
  input.addedLightningDamage[1].source.id = 'ring-2';
  input.addedLightningDamage[1].source.line = 12;
  const provenance = checkUpdate(session, input).calculation.addedLightningDamage.contributions;
  assert.equal(provenance[1].source.id, 'ring-2');
  assert.equal(provenance[1].source.line, 12);
  input.addedLightningDamage.splice(0, 1);
  const removed = checkUpdate(session, input);
  assert.deepEqual(removed.dependencies['added-lightning'], ['added-lightning:0']);
  assert.deepEqual(removed.calculation.addedLightningDamage.raw, { min: 3, max: 12, mean: 7.5 });
  input.addedLightningDamage.push(added(0, 0, 'zero-source', 13));
  checkUpdate(session, input);
  input.addedLightningDamage = [];
  const empty = checkUpdate(session, input);
  assert.deepEqual(empty.dependencies['added-lightning'], []);
  assert.deepEqual(empty.calculation.addedLightningDamage.raw, { min: 0, max: 0, mean: 0 });
  input.addedLightningDamage = undefined;
  checkUpdate(session, input);
});

test('new gem-level effectiveness invalidates scaled added damage while retaining raw sums', () => {
  const synthetic = structuredClone(dataset);
  delete synthetic.supports;
  delete synthetic.critical;
  delete synthetic.resistance;
  delete synthetic.shock;
  delete synthetic.conductivity;
  synthetic.levels.find((level) => level.gemLevel === 1).addedDamageEffectiveness = 0.5;
  synthetic.identity.snapshotId += '-synthetic-effectiveness';
  const input = {
    ...structuredClone(basic),
    identity: synthetic.identity,
    addedLightningDamage: [added(4, 10)],
  };
  const session = value(createSelectedSkillSession(input, synthetic));
  input.skill.gemLevel = 1;
  const report = value(session.recalculate(input));
  assert.deepEqual(report.calculation, value(calculateSelectedSkill(input, synthetic)));
  assert.ok(report.recalculated.includes('base'));
  assert.ok(report.recalculated.includes('effective-added-lightning'));
  assert.ok(!report.recalculated.includes('added-lightning'));
  assert.deepEqual(report.calculation.addedLightningDamage.raw, { min: 4, max: 10, mean: 7 });
  assert.deepEqual(report.calculation.addedLightningDamage.effective, {
    min: 2,
    max: 5,
    mean: 3.5,
  });
  assert.equal(report.calculation.addedLightningDamage.effectiveness, 0.5);
});

test('support level, enabled state and provenance update independently from base and increases', () => {
  const input = { ...structuredClone(basic), addedLightningDamage: [added(2, 8)] };
  input.skill.supports = [support()];
  const session = value(createSelectedSkillSession(input, dataset));
  assert.deepEqual(session.current.calculation, value(calculateSelectedSkill(input, dataset)));
  assert.equal(
    session.current.calculation.supportEffects.spellDamageMultiplier,
    1 +
      dataset.supports[0].levels.find((level) => level.gemLevel === 1).moreSpellDamagePercent / 100,
  );
  assert.equal(session.current.calculation.supportEffects.castTimeMultiplier, 1);
  assert.equal(session.current.calculation.supportEffects.contributions.length, 2);
  input.skill.supports[0].gemLevel = 20;
  const leveled = checkUpdate(session, input);
  assert.equal(leveled.calculation.supportEffects.spellDamageMultiplier, 1 + 39 / 100);
  assert.deepEqual(
    [...leveled.recalculated].sort(),
    [
      'support-effects',
      'cast-rate',
      'damage-before-resistance',
      'damage-after-resistance',
      'critical-effects',
      'shock-effects',
      'selected-skill',
    ].sort(),
  );
  assert.ok(!leveled.recalculated.includes('base'));
  assert.ok(!leveled.recalculated.includes('damage-increase'));
  assert.ok(!leveled.recalculated.includes('added-lightning'));
  input.skill.supports[0].enabled = false;
  const disabled = checkUpdate(session, input).calculation.supportEffects;
  assert.equal(disabled.spellDamageMultiplier, 1);
  assert.equal(disabled.criticalChanceMultiplier, 1);
  assert.equal(disabled.castTimeMultiplier, 1);
  assert.ok(disabled.contributions.every((contribution) => !contribution.appliedToSelectedHit));
  input.skill.supports[0].source.id = 'synthetic-support-moved';
  input.skill.supports[0].source.line = 2;
  const provenance = checkUpdate(session, input).calculation.supportEffects;
  assert.equal(provenance.supports[0].source.id, 'synthetic-support-moved');
  assert.ok(
    provenance.contributions.every(
      (contribution) => contribution.source.id === 'synthetic-support-moved',
    ),
  );
  input.skill.supports[0].enabled = true;
  const enabled = checkUpdate(session, input).calculation.supportEffects;
  assert.ok(
    enabled.contributions.some(
      (contribution) =>
        contribution.operation === 'more-spell-damage' && contribution.appliedToSelectedHit,
    ),
  );
  assert.ok(
    enabled.contributions.some(
      (contribution) =>
        contribution.operation === 'less-critical-strike-chance' &&
        !contribution.appliedToSelectedHit,
    ),
  );
  input.skill.supports = [];
  const removed = checkUpdate(session, input).calculation.supportEffects;
  assert.equal(removed.spellDamageMultiplier, 1);
  assert.deepEqual(removed.supports, []);
  assert.deepEqual(removed.contributions, []);
});

test('invalid and unavailable supports reject atomically, including disabled unknown supports', () => {
  const input = structuredClone(basic);
  input.skill.supports = [support()];
  const session = value(createSelectedSkillSession(input, dataset));
  const original = session.current;
  for (const mutate of [
    (next) => {
      next.skill.supports[0].id = 'UnknownSupport';
    },
    (next) => {
      next.skill.supports[0].id = 'UnknownSupport';
      next.skill.supports[0].enabled = false;
    },
    (next) => {
      next.skill.supports.push(support(20));
    },
    (next) => {
      next.skill.supports[0].gemLevel = 0;
    },
    (next) => {
      next.skill.supports[0].gemLevel = 21;
    },
    (next) => {
      next.skill.supports[0].quality = 1;
    },
    (next) => {
      next.skill.supports[0].enabled = 'false';
    },
    (next) => {
      next.skill.supports[0].source.line = 0;
    },
    (next) => {
      next.skill.supports[0].source = Object.create(next.skill.supports[0].source);
    },
    (next) => {
      next.skill.supports[0].conditions = ['on-low-life'];
    },
    (next) => {
      next.skill.supports[0] = 'SupportControlledDestruction';
    },
  ]) {
    const next = structuredClone(input);
    mutate(next);
    assert.equal(calculateSelectedSkill(next, dataset).ok, false);
    assert.equal(session.recalculate(next).ok, false);
    assert.equal(session.current, original);
  }
  const unavailable = structuredClone(dataset);
  delete unavailable.supports;
  const noSupport = value(createSelectedSkillSession(basic, unavailable));
  const before = noSupport.current;
  assert.equal(calculateSelectedSkill(input, unavailable).ok, false);
  assert.equal(noSupport.recalculate(input).ok, false);
  assert.equal(noSupport.current, before);
  checkUpdate(session, input);
});

test('support input, normalized facts and reported trace have independent ownership', () => {
  const input = structuredClone(basic);
  input.skill.supports = [support()];
  const expected = structuredClone(input);
  const ownedDataset = structuredClone(dataset);
  const session = value(createSelectedSkillSession(input, ownedDataset));
  const original = structuredClone(session.current.calculation);
  input.skill.supports[0].source.id = 'host-source-mutated';
  input.skill.supports[0].gemLevel = 20;
  ownedDataset.supports[0].levels[0].moreSpellDamagePercent = 999;
  ownedDataset.supports[0].sourceRows[0].key = 'host-support-row-mutated';
  ownedDataset.supports[0].levels[0].sourceRows[0].key = 'host-support-level-row-mutated';
  assert.deepEqual(session.current.calculation, original);
  assert.throws(() => {
    session.current.calculation.supportEffects.supports[0].source.id = 'mutated';
  }, TypeError);
  assert.throws(() => {
    session.current.calculation.supportEffects.contributions[0].sourceRows[0].key = 'mutated';
  }, TypeError);
  expected.skill.supports[0].gemLevel = 20;
  checkUpdate(session, expected);
  expected.skill.supports[0].gemLevel = 1;
  expected.skill.supports[0].quality = -0;
  checkUpdate(session, expected);
});

test('support facts reject cycles, inherited identities, sparse levels and snapshot mismatches', () => {
  for (const select of [
    (data) => data.supports[0],
    (data) => data.supports[0].identity,
    (data) => data.supports[0].levels[0],
    (data) => data.supports[0].sourceRows[0],
    (data) => data.supports[0].levels[0].sourceRows[0],
  ]) {
    const malformed = structuredClone(dataset);
    const target = select(malformed);
    target.extra = {};
    target.extra.self = target.extra;
    assert.equal(calculateSelectedSkill(basic, malformed).ok, false);
    assert.equal(createSelectedSkillSession(basic, malformed).ok, false);
  }
  for (const mutate of [
    (data) => {
      data.supports[0].identity.snapshotId += '-different';
    },
    (data) => {
      data.supports[0].identity = Object.create(data.supports[0].identity);
    },
    (data) => {
      delete data.supports[0].levels[0];
    },
    (data) => {
      delete data.supports[0].sourceRows[0];
    },
    (data) => {
      delete data.supports[0].levels[0].sourceRows[0];
    },
    (data) => {
      data.supports[0].levels[0].criticalStrikeChancePercent = -99;
    },
  ]) {
    const malformed = structuredClone(dataset);
    mutate(malformed);
    assert.equal(calculateSelectedSkill(basic, malformed).ok, false);
    assert.equal(createSelectedSkillSession(basic, malformed).ok, false);
  }
});

test('Faster Casting adds to the item pool once and retains separate provenance', () => {
  const input = structuredClone(basic);
  input.skill.supports = [fasterCasting()];
  const session = value(createSelectedSkillSession(input, dataset));
  const first = session.current.calculation;
  assert.deepEqual(first, value(calculateSelectedSkill(input, dataset)));
  assert.equal(first.supportEffects.increasedCastSpeedPercent, 20);
  assert.equal(first.hit.increasedCastSpeedPercent, 45);
  assert.equal(first.hit.castsPerSecond, 1.45 / 0.6);
  assert.equal(first.hit.baseCastTimeSeconds, 0.6);
  assert.equal(first.supportEffects.castTimeMultiplier, 1);
  assert.equal(
    first.hit.modifierContributions.filter((entry) => entry.statId === 'base_cast_speed_+%').length,
    1,
  );
  const occurrence = first.supportEffects.contributions.find(
    (entry) => entry.operation === 'increased-cast-speed',
  );
  assert.equal(occurrence.statId, 'base_cast_speed_+%');
  assert.equal(occurrence.value, 20);
  assert.equal(occurrence.appliedToCastRate, true);
  assert.equal(occurrence.appliedToSelectedHit, false);
  input.configuration.effectiveLightningResistancePercent = 50;
  const enemyChanged = checkUpdate(session, input);
  assert.equal(enemyChanged.calculation.hit.increasedCastSpeedPercent, 45);
  assert.ok(!enemyChanged.recalculated.includes('cast-rate'));
  input.skill.supports[0].gemLevel = 20;
  const levelChanged = checkUpdate(session, input);
  assert.equal(levelChanged.calculation.supportEffects.increasedCastSpeedPercent, 39);
  assert.equal(levelChanged.calculation.hit.increasedCastSpeedPercent, 64);
  assert.equal(levelChanged.calculation.hit.castsPerSecond, 1.64 / 0.6);
  assert.deepEqual(
    levelChanged.calculation.hit.nonCriticalHitBeforeResistance,
    first.hit.nonCriticalHitBeforeResistance,
  );
  input.modifiers[2].value = 10000;
  const capped = checkUpdate(session, input).calculation;
  assert.equal(capped.hit.increasedCastSpeedPercent, 10039);
  assert.equal(capped.hit.castsPerSecond, 1 / 0.033);
  input.modifiers[2].value = 25;
  checkUpdate(session, input);
  input.skill.supports[0].source.id = 'moved-faster-casting';
  const moved = checkUpdate(session, input).calculation;
  assert.equal(moved.supportEffects.contributions[0].source.id, 'moved-faster-casting');
  input.skill.supports[0].enabled = false;
  const disabled = checkUpdate(session, input).calculation;
  assert.equal(disabled.supportEffects.increasedCastSpeedPercent, 0);
  assert.equal(disabled.hit.increasedCastSpeedPercent, 25);
  assert.equal(disabled.supportEffects.contributions[0].value, 39);
  assert.equal(disabled.supportEffects.contributions[0].appliedToCastRate, false);
});

test('both supports preserve input order and independent enabled-state effects', () => {
  const input = structuredClone(basic);
  input.configuration.criticalStrikeMode = 'average';
  input.configuration.ailmentMode = 'configured-shock';
  input.configuration.shock = shock(20, 50);
  input.skill.supports = [support(), fasterCasting()];
  const session = value(createSelectedSkillSession(input, dataset));
  const initial = session.current.calculation;
  assert.equal(initial.supportEffects.spellDamageMultiplier, 1.25);
  assert.equal(initial.supportEffects.increasedCastSpeedPercent, 20);
  assert.equal(initial.criticalEffects.chancePercent, 1.2);
  assert.equal(
    initial.supportEffects.manaCostMultiplier,
    dataset.supports
      .find((entry) => entry.id === 'SupportControlledDestruction')
      .levels.find((level) => level.gemLevel === 1).manaCostMultiplier *
      dataset.supports
        .find((entry) => entry.id === 'SupportFasterCasting')
        .levels.find((level) => level.gemLevel === 1).manaCostMultiplier,
  );
  input.skill.supports.reverse();
  const reordered = checkUpdate(session, input).calculation;
  assert.deepEqual(
    reordered.supportEffects.supports.map((entry) => entry.id),
    ['SupportFasterCasting', 'SupportControlledDestruction'],
  );
  assert.equal(reordered.supportEffects.contributions[0].operation, 'increased-cast-speed');
  assert.equal(reordered.hit.castsPerSecond, initial.hit.castsPerSecond);
  assert.deepEqual(
    reordered.hit.nonCriticalHitAfterResistance,
    initial.hit.nonCriticalHitAfterResistance,
  );
  assert.equal(reordered.hitDps, initial.hitDps);
  input.skill.supports[1].enabled = false;
  const noDestruction = checkUpdate(session, input).calculation;
  assert.equal(noDestruction.supportEffects.spellDamageMultiplier, 1);
  assert.equal(noDestruction.supportEffects.increasedCastSpeedPercent, 20);
  assert.equal(noDestruction.criticalEffects.chancePercent, 6);
  assert.ok(
    noDestruction.supportEffects.contributions
      .filter((entry) => entry.operation === 'less-critical-strike-chance')
      .every((entry) => !entry.appliedToSelectedHit),
  );
  input.skill.supports[0].enabled = false;
  const neither = checkUpdate(session, input).calculation;
  assert.equal(neither.supportEffects.increasedCastSpeedPercent, 0);
  assert.equal(neither.supportEffects.manaCostMultiplier, 1);
  input.skill.supports = [support()];
  checkUpdate(session, input);
  input.skill.supports.push(fasterCasting(20));
  assert.equal(
    checkUpdate(session, input).calculation.supportEffects.increasedCastSpeedPercent,
    39,
  );
  input.skill.supports = [fasterCasting(20)];
  const onlyCasting = checkUpdate(session, input).calculation;
  assert.equal(onlyCasting.supportEffects.spellDamageMultiplier, 1);
  assert.equal(onlyCasting.criticalEffects.chancePercent, 6);
  assert.equal(onlyCasting.supportEffects.contributions.length, 1);
});

test('Faster Casting can rescue a nonpositive item-only pool and reclassification updates dependencies', () => {
  const input = structuredClone(basic);
  input.modifiers[2].value = -100;
  input.skill.supports = [fasterCasting()];
  const session = value(createSelectedSkillSession(input, dataset));
  assert.deepEqual(session.current.calculation, value(calculateSelectedSkill(input, dataset)));
  assert.equal(session.current.calculation.hit.increasedCastSpeedPercent, -80);
  assert.equal(session.current.calculation.hit.castsPerSecond, 0.2 / 0.6);
  input.configuration.effectiveLightningResistancePercent = 50;
  checkUpdate(session, input);
  input.modifiers[0].statId = 'base_cast_speed_+%';
  const reclassified = checkUpdate(session, input);
  assert.deepEqual(reclassified.dependencies['cast-speed-increase'], ['modifier:0', 'modifier:2']);
  assert.deepEqual(reclassified.dependencies['damage-increase'], ['modifier:1']);
  assert.equal(reclassified.calculation.hit.increasedCastSpeedPercent, -60);
  input.modifiers.splice(2, 1);
  const removed = checkUpdate(session, input);
  assert.deepEqual(removed.dependencies['cast-speed-increase'], ['modifier:0']);
  assert.equal(removed.calculation.hit.increasedCastSpeedPercent, 40);
});

test('combined cast-speed failures reject atomically after support effects and recover', () => {
  const input = structuredClone(basic);
  input.modifiers[2].value = -120;
  input.skill.supports = [fasterCasting(20)];
  const session = value(createSelectedSkillSession(input, dataset));
  for (const mutate of [
    (next) => {
      next.skill.supports[0].gemLevel = 1;
    },
    (next) => {
      next.skill.supports[0].enabled = false;
    },
    (next) => {
      next.skill.supports = [];
    },
    (next) => {
      next.modifiers[2].value = -200;
    },
  ]) {
    const next = structuredClone(input);
    mutate(next);
    const before = session.current;
    const full = calculateSelectedSkill(next, dataset);
    const incremental = session.recalculate(next);
    assert.equal(full.ok, false);
    assert.equal(incremental.ok, false);
    assert.equal(full.diagnostics[0].code, 'selected.cast-speed');
    assert.equal(incremental.diagnostics[0].code, 'selected.cast-speed');
    assert.equal(session.current, before);
  }
  const recovered = structuredClone(input);
  recovered.skill.supports[0].gemLevel = 19;
  checkUpdate(session, recovered);
  recovered.skill.supports[0].gemLevel = 1;
  recovered.modifiers[2].value = -119.4;
  assert.equal(checkUpdate(session, recovered).calculation.hit.castsPerSecond, 0.01 / 0.6);
  const invalidRounded = structuredClone(recovered);
  invalidRounded.modifiers[2].value = -119.6;
  const before = session.current;
  assert.equal(calculateSelectedSkill(invalidRounded, dataset).ok, false);
  assert.equal(session.recalculate(invalidRounded).ok, false);
  assert.equal(session.current, before);
});

test('invalid duplicate, extra and unavailable Faster Casting supports stay visible', () => {
  const input = structuredClone(basic);
  input.skill.supports = [support(), fasterCasting()];
  const session = value(createSelectedSkillSession(input, dataset));
  const original = session.current;
  for (const mutate of [
    (next) => {
      next.skill.supports = [fasterCasting(), fasterCasting(20)];
    },
    (next) => {
      next.skill.supports.push(support(20));
    },
    (next) => {
      next.skill.supports[1].quality = 20;
    },
    (next) => {
      next.skill.supports[1].id = 'SupportFasterCast';
    },
    (next) => {
      next.skill.supports[1].gemLevel = 21;
    },
    (next) => {
      next.skill.supports[1].source = Object.create(next.skill.supports[1].source);
    },
  ]) {
    const next = structuredClone(input);
    mutate(next);
    assert.equal(calculateSelectedSkill(next, dataset).ok, false);
    assert.equal(session.recalculate(next).ok, false);
    assert.equal(session.current, original);
  }
  const partial = structuredClone(dataset);
  partial.supports = partial.supports.filter((entry) => entry.id !== 'SupportFasterCasting');
  const onlyDestruction = structuredClone(basic);
  onlyDestruction.skill.supports = [support()];
  const withoutCasting = value(createSelectedSkillSession(onlyDestruction, partial));
  const before = withoutCasting.current;
  assert.equal(calculateSelectedSkill(input, partial).ok, false);
  assert.equal(withoutCasting.recalculate(input).ok, false);
  assert.equal(withoutCasting.current, before);
});

test('Faster Casting facts and sources are captured independently in either dataset order', () => {
  const input = structuredClone(basic);
  input.skill.supports = [support(), fasterCasting()];
  const expected = structuredClone(input);
  const ownedDataset = structuredClone(dataset);
  ownedDataset.supports.reverse();
  const session = value(createSelectedSkillSession(input, ownedDataset));
  const original = structuredClone(session.current.calculation);
  input.skill.supports[1].source.id = 'host-casting-source';
  const facts = ownedDataset.supports.find((entry) => entry.id === 'SupportFasterCasting');
  facts.levels.find((level) => level.gemLevel === 1).increasedCastSpeedPercent = 999;
  facts.sourceRows[0].key = 'host-casting-row';
  facts.levels[0].sourceRows[0].key = 'host-casting-level-row';
  assert.deepEqual(session.current.calculation, original);
  assert.throws(() => {
    session.current.calculation.supportEffects.contributions.find(
      (entry) => entry.operation === 'increased-cast-speed',
    ).source.id = 'changed';
  }, TypeError);
  expected.skill.supports[1].gemLevel = 20;
  checkUpdate(session, expected);
});

test('Conductivity level, enabled state and effect changes refresh the resistance chain only', () => {
  const input = configuredInput(100, [exposure(-10)]);
  input.configuration.ailmentMode = 'excluded';
  input.configuration.lightningResistance.conductivity = conductivity();
  input.modifiers.push(modifier('base_reduce_enemy_lightning_resistance_%', 15, 17));
  const session = value(createSelectedSkillSession(input, dataset));
  assert.deepEqual(session.current.calculation, value(calculateSelectedSkill(input, dataset)));
  const first = session.current.calculation.resistanceEffects.conductivity;
  const firstLevel = dataset.conductivity.levels.find((level) => level.gemLevel === 1);
  assert.equal(first.baseLightningResistancePercent, firstLevel.baseLightningResistancePercent);
  assert.equal(first.appliedLightningResistancePercent, firstLevel.baseLightningResistancePercent);
  assert.equal(first.durationMilliseconds, firstLevel.durationMilliseconds);
  assert.equal(first.radiusIncrement, firstLevel.radiusIncrement);
  assert.equal(first.excludedShockChance.basePercent, 25);
  assert.equal(first.excludedShockChance.appliedToSelectedHit, false);
  assert.equal(
    session.current.calculation.resistanceEffects.uncappedResistancePercent,
    100 - 10 + first.appliedLightningResistancePercent,
  );
  const state = input.configuration.lightningResistance.conductivity;
  state.gemLevel = 20;
  const leveled = checkUpdate(session, input);
  assert.deepEqual(leveled.recalculated, [
    'conductivity-effects',
    'uncapped-resistance',
    'capped-resistance',
    'effective-resistance',
    'resistance-effects',
    'damage-after-resistance',
    'critical-effects',
    'shock-effects',
    'selected-skill',
  ]);
  assert.ok(!leveled.recalculated.includes('lightning-exposure'));
  assert.ok(!leveled.recalculated.includes('lightning-penetration'));
  assert.ok(!leveled.recalculated.includes('damage-before-resistance'));
  assert.ok(!leveled.recalculated.includes('cast-rate'));
  state.enabled = false;
  const disabled = checkUpdate(session, input).calculation;
  assert.equal(disabled.resistanceEffects.conductivity.appliedLightningResistancePercent, 0);
  assert.equal(disabled.resistanceEffects.effectiveResistancePercent, 75);
  state.enabled = true;
  state.increasedEffectPercent = 33;
  const scaled = checkUpdate(session, input).calculation.resistanceEffects.conductivity;
  assert.equal(scaled.effectMultiplier, 1.33);
  assert.equal(
    scaled.scaledLightningResistancePercent,
    scaled.baseLightningResistancePercent * 1.33,
  );
  assert.equal(
    scaled.roundedLightningResistancePercent,
    Math.floor(scaled.scaledLightningResistancePercent * 100 + 0.5) / 100,
  );
  assert.equal(
    scaled.truncatedLightningResistancePercent,
    Math.trunc(scaled.roundedLightningResistancePercent),
  );
  assert.equal(
    scaled.appliedLightningResistancePercent,
    scaled.truncatedLightningResistancePercent,
  );
  state.increasedEffectPercent = -100;
  assert.equal(
    checkUpdate(session, input).calculation.resistanceEffects.conductivity
      .appliedLightningResistancePercent,
    0,
  );
  state.increasedEffectPercent = 200;
  checkUpdate(session, input);
  state.source.id = 'moved-conductivity-source';
  state.effectSource.id = 'moved-curse-effect-source';
  const movedReport = checkUpdate(session, input);
  assert.deepEqual(movedReport.recalculated, [
    'conductivity-effects',
    'uncapped-resistance',
    'capped-resistance',
    'effective-resistance',
    'resistance-effects',
    'damage-after-resistance',
    'critical-effects',
    'shock-effects',
    'selected-skill',
  ]);
  const moved = movedReport.calculation.resistanceEffects.conductivity;
  assert.equal(moved.resistanceContribution.source.id, 'moved-conductivity-source');
  assert.equal(moved.effectContribution.source.id, 'moved-curse-effect-source');
  delete input.configuration.lightningResistance.conductivity;
  const removed = checkUpdate(session, input);
  assert.equal(removed.calculation.resistanceEffects.conductivity, null);
  assert.equal(removed.calculation.resistanceEffects.effectiveResistancePercent, 75);
});

test('Conductivity combines before caps with exposure and remains separate from penetration and casts', () => {
  const input = configuredInput(-195, [exposure(-10)]);
  input.configuration.criticalStrikeMode = 'average';
  input.configuration.ailmentMode = 'configured-shock';
  input.configuration.shock = shock(30, 40);
  input.configuration.lightningResistance.conductivity = conductivity(20, true, 25);
  input.skill.supports = [support(), fasterCasting()];
  input.addedLightningDamage = [added(2, 8)];
  input.modifiers.push(modifier('base_reduce_enemy_lightning_resistance_%', 20, 17));
  const session = value(createSelectedSkillSession(input, dataset));
  const first = session.current.calculation;
  assert.deepEqual(first, value(calculateSelectedSkill(input, dataset)));
  assert.equal(
    first.resistanceEffects.uncappedResistancePercent,
    -195 - 10 + first.resistanceEffects.conductivity.appliedLightningResistancePercent,
  );
  assert.equal(first.resistanceEffects.cappedResistancePercent, -200);
  assert.equal(first.resistanceEffects.effectiveResistancePercent, -220);
  input.modifiers[3].value = 30;
  const penetration = checkUpdate(session, input);
  assert.equal(penetration.calculation.resistanceEffects.effectiveResistancePercent, -230);
  assert.ok(!penetration.recalculated.includes('conductivity-effects'));
  assert.ok(!penetration.recalculated.includes('uncapped-resistance'));
  input.modifiers[0].statId = 'base_reduce_enemy_lightning_resistance_%';
  const reclassified = checkUpdate(session, input);
  assert.deepEqual(reclassified.dependencies['lightning-penetration'], [
    'modifier:0',
    'modifier:3',
  ]);
  assert.ok(!reclassified.recalculated.includes('conductivity-effects'));
  input.configuration.criticalStrikeMode = 'disabled';
  assert.deepEqual(checkUpdate(session, input).recalculated, [
    'critical-effects',
    'shock-effects',
    'selected-skill',
  ]);
  input.skill.supports[1].enabled = false;
  assert.ok(!checkUpdate(session, input).recalculated.includes('conductivity-effects'));
  input.configuration.lightningResistance.baseResistancePercent = 100;
  checkUpdate(session, input);
  input.configuration.lightningResistance.conductivity.enabled = false;
  const disabled = checkUpdate(session, input);
  assert.equal(disabled.calculation.resistanceEffects.uncappedResistancePercent, 90);
  assert.equal(disabled.calculation.resistanceEffects.effectiveResistancePercent, 40);
});

test('Conductivity rejects unsupported profiles, conditions and missing facts atomically', () => {
  const initial = configuredInput(50);
  initial.configuration.ailmentMode = 'excluded';
  initial.configuration.lightningResistance.conductivity = conductivity();
  const session = value(createSelectedSkillSession(initial, dataset));
  const before = session.current;
  for (const mutate of [
    (input) => {
      delete input.configuration.ailmentMode;
    },
    (input) => {
      input.configuration.lightningResistance.conductivity.id = 'ElementalWeakness';
    },
    (input) => {
      input.configuration.lightningResistance.conductivity.gemLevel = 0;
    },
    (input) => {
      input.configuration.lightningResistance.conductivity.gemLevel = 21;
    },
    (input) => {
      input.configuration.lightningResistance.conductivity.quality = 1;
    },
    (input) => {
      input.configuration.lightningResistance.conductivity.enabled = 'false';
    },
    (input) => {
      input.configuration.lightningResistance.conductivity.increasedEffectPercent = -101;
    },
    (input) => {
      input.configuration.lightningResistance.conductivity.increasedEffectPercent = 201;
    },
    (input) => {
      input.configuration.lightningResistance.conductivity.increasedEffectPercent = 0.5;
    },
    (input) => {
      delete input.configuration.lightningResistance.conductivity.effectSource;
    },
    (input) => {
      input.configuration.lightningResistance.conductivity.source.kind = 'item';
    },
    (input) => {
      input.configuration.lightningResistance.conductivity.effectSource.kind = 'skill';
    },
    (input) => {
      input.configuration.lightningResistance.conductivity.source = Object.create(
        input.configuration.lightningResistance.conductivity.source,
      );
    },
    (input) => {
      input.configuration.lightningResistance.conductivity.curseLimit = 2;
    },
    (input) => {
      input.configuration.lightningResistance.conductivity = null;
    },
    (input) => {
      const state = input.configuration.lightningResistance.conductivity;
      delete input.configuration.lightningResistance.conductivity;
      Object.setPrototypeOf(input.configuration.lightningResistance, { conductivity: state });
    },
    (input) => {
      delete input.configuration.lightningResistance.conductivity;
      Object.setPrototypeOf(input.configuration.lightningResistance, { conductivity: null });
    },
    (input) => {
      input.modifiers.push(modifier('base_lightning_damage_resistance_%', -20, 18));
    },
    (input) => {
      input.modifiers.push(modifier('curse_effect_+%', 25, 18));
    },
    (input) => {
      input.modifiers.push(modifier('chance_to_be_shocked_%', 25, 18));
    },
  ]) {
    const input = structuredClone(initial);
    mutate(input);
    assert.equal(calculateSelectedSkill(input, dataset).ok, false);
    assert.equal(createSelectedSkillSession(input, dataset).ok, false);
    assert.equal(session.recalculate(input).ok, false);
    assert.equal(session.current, before);
  }
  const legacy = structuredClone(basic);
  legacy.configuration.conductivity = conductivity();
  assert.equal(calculateSelectedSkill(legacy, dataset).ok, false);
  assert.equal(session.recalculate(legacy).ok, false);
  assert.equal(session.current, before);
  const unavailable = structuredClone(dataset);
  delete unavailable.conductivity;
  const noCurse = configuredInput(50);
  noCurse.configuration.ailmentMode = 'excluded';
  const incomplete = value(createSelectedSkillSession(noCurse, unavailable));
  const last = incomplete.current;
  for (const enabled of [true, false]) {
    const input = structuredClone(initial);
    input.configuration.lightningResistance.conductivity.enabled = enabled;
    assert.equal(calculateSelectedSkill(input, unavailable).ok, false);
    assert.equal(incomplete.recalculate(input).ok, false);
    assert.equal(incomplete.current, last);
  }
  const recovered = structuredClone(noCurse);
  recovered.configuration.lightningResistance.baseResistancePercent = 60;
  assert.deepEqual(
    value(incomplete.recalculate(recovered)).calculation,
    value(calculateSelectedSkill(recovered, unavailable)),
  );
});

test('Conductivity configuration, effect provenance and normalized rows have independent ownership', () => {
  const input = configuredInput(80);
  input.configuration.ailmentMode = 'excluded';
  input.configuration.lightningResistance.conductivity = conductivity();
  const expected = structuredClone(input);
  const ownedDataset = structuredClone(dataset);
  const session = value(createSelectedSkillSession(input, ownedDataset));
  const original = structuredClone(session.current.calculation);
  input.configuration.lightningResistance.conductivity.source.id = 'host-curse-source';
  input.configuration.lightningResistance.conductivity.effectSource.id = 'host-effect-source';
  ownedDataset.conductivity.ruleSource.id = 'host-curse-rule';
  ownedDataset.conductivity.levels[0].baseLightningResistancePercent = -99;
  ownedDataset.conductivity.sourceRows[0].key = 'host-curse-row';
  ownedDataset.conductivity.levels[0].sourceRows[0].key = 'host-curse-level-row';
  assert.deepEqual(session.current.calculation, original);
  const current = session.current.calculation.resistanceEffects.conductivity;
  for (const target of [
    current.configuration.source,
    current.configuration.effectSource,
    current.resistanceContribution.source,
    current.effectContribution.source,
    current.excludedShockChance.source,
    current.ruleSource,
  ]) {
    assert.throws(() => {
      target.id = 'changed';
    }, TypeError);
  }
  expected.configuration.lightningResistance.conductivity.gemLevel = 20;
  checkUpdate(session, expected);
  expected.configuration.lightningResistance.conductivity.increasedEffectPercent = -0;
  checkUpdate(session, expected);
  delete expected.configuration.lightningResistance.conductivity;
  const removed = checkUpdate(session, expected);
  assert.equal(removed.calculation.resistanceEffects.conductivity, null);
});

test('Conductivity facts reject inherited, sparse, cyclic and mismatched records', () => {
  for (const select of [
    (data) => data.conductivity,
    (data) => data.conductivity.identity,
    (data) => data.conductivity.ruleSource,
    (data) => data.conductivity.levels[0],
    (data) => data.conductivity.sourceRows[0],
    (data) => data.conductivity.levels[0].sourceRows[0],
  ]) {
    const malformed = structuredClone(dataset);
    const target = select(malformed);
    target.extra = {};
    target.extra.self = target.extra;
    assert.equal(calculateSelectedSkill(basic, malformed).ok, false);
    assert.equal(createSelectedSkillSession(basic, malformed).ok, false);
  }
  for (const mutate of [
    (data) => {
      data.conductivity.identity.snapshotId += '-different';
    },
    (data) => {
      data.conductivity.chanceToBeShockedPercent = 26;
    },
    (data) => {
      delete data.conductivity.levels[0];
    },
    (data) => {
      data.conductivity.levels[1].gemLevel = data.conductivity.levels[0].gemLevel;
    },
    (data) => {
      data.conductivity.sourceRows[0] = Object.create(data.conductivity.sourceRows[0]);
    },
    (data) => {
      delete data.conductivity.levels[0].sourceRows[0];
    },
    (data) => {
      data.conductivity.ruleSource.id = 'unverified-curse-rule';
    },
  ]) {
    const malformed = structuredClone(dataset);
    mutate(malformed);
    assert.equal(calculateSelectedSkill(basic, malformed).ok, false);
    assert.equal(createSelectedSkillSession(basic, malformed).ok, false);
  }
});

test('critical chance and multiplier edits retain separate applicability sets and normal-hit caches', () => {
  const input = structuredClone(basic);
  input.configuration.criticalStrikeMode = 'average';
  input.configuration.ailmentMode = 'excluded';
  input.modifiers.push(modifier('critical_strike_chance_+%', 100, 14));
  input.modifiers.push(modifier('spell_critical_strike_chance_+%', 50, 15));
  input.modifiers.push(modifier('base_critical_strike_multiplier_+', 50, 16));
  const session = value(createSelectedSkillSession(input, dataset));
  assert.deepEqual(session.current.calculation, value(calculateSelectedSkill(input, dataset)));
  assert.equal(session.current.calculation.criticalEffects.chancePercent, 15);
  assert.equal(session.current.calculation.criticalEffects.criticalMultiplier, 2);
  assert.equal(session.current.calculation.hit.modifierContributions.length, 3);
  assert.equal(session.current.calculation.criticalEffects.modifierContributions.length, 3);
  assert.deepEqual(session.current.dependencies['critical-chance-increase'], [
    'modifier:3',
    'modifier:4',
  ]);
  assert.deepEqual(session.current.dependencies['critical-multiplier-increase'], ['modifier:5']);
  input.modifiers[3].value = 200;
  const changed = checkUpdate(session, input);
  assert.deepEqual(changed.recalculated, [
    'critical-chance-increase',
    'critical-effects',
    'shock-effects',
    'selected-skill',
  ]);
  assert.equal(changed.calculation.criticalEffects.chancePercent, 21);
  input.modifiers[3].statId = 'base_critical_strike_multiplier_+';
  const reclassified = checkUpdate(session, input);
  assert.deepEqual(reclassified.dependencies['critical-chance-increase'], ['modifier:4']);
  assert.deepEqual(reclassified.dependencies['critical-multiplier-increase'], [
    'modifier:3',
    'modifier:5',
  ]);
  assert.equal(reclassified.calculation.criticalEffects.chancePercent, 9);
  assert.equal(reclassified.calculation.criticalEffects.criticalMultiplier, 4);
  assert.ok(!reclassified.recalculated.includes('damage-increase'));
  assert.ok(!reclassified.recalculated.includes('cast-rate'));
  input.modifiers[3].statId = 'spell_damage_+%';
  const intoDamage = checkUpdate(session, input);
  assert.ok(intoDamage.recalculated.includes('damage-increase'));
  assert.ok(intoDamage.recalculated.includes('critical-multiplier-increase'));
  assert.deepEqual(intoDamage.dependencies['damage-increase'], [
    'modifier:0',
    'modifier:1',
    'modifier:3',
  ]);
  input.modifiers.splice(4, 2);
  const removed = checkUpdate(session, input);
  assert.deepEqual(removed.dependencies['critical-chance-increase'], []);
  assert.deepEqual(removed.dependencies['critical-multiplier-increase'], []);
  assert.deepEqual(removed.calculation.criticalEffects.modifierContributions, []);
});

test('critical mode changes preserve normal damage and cast caches and update support applicability', () => {
  const input = structuredClone(basic);
  input.skill.supports = [support()];
  input.configuration.ailmentMode = 'excluded';
  const session = value(createSelectedSkillSession(input, dataset));
  input.configuration.criticalStrikeMode = 'average';
  const averaged = checkUpdate(session, input);
  assert.deepEqual(averaged.recalculated, ['critical-effects', 'shock-effects', 'selected-skill']);
  assert.equal(averaged.calculation.criticalEffects.lessChanceMultiplier, 0.2);
  assert.equal(averaged.calculation.criticalEffects.chancePercent, 1.2);
  assert.equal(averaged.calculation.hitsPerCast, 1);
  assert.ok(
    averaged.calculation.supportEffects.contributions.some(
      (entry) => entry.operation === 'less-critical-strike-chance' && entry.appliedToSelectedHit,
    ),
  );
  input.skill.supports[0].enabled = false;
  const noSupport = checkUpdate(session, input);
  assert.equal(noSupport.calculation.criticalEffects.chancePercent, 6);
  assert.ok(
    noSupport.calculation.supportEffects.contributions.every(
      (entry) => !entry.appliedToSelectedHit,
    ),
  );
  input.skill.supports[0].enabled = true;
  checkUpdate(session, input);
  input.configuration.criticalStrikeMode = 'disabled';
  const disabled = checkUpdate(session, input);
  assert.deepEqual(disabled.recalculated, ['critical-effects', 'shock-effects', 'selected-skill']);
  assert.equal(disabled.calculation.criticalEffects.chancePercent, 0);
  assert.equal(
    disabled.calculation.criticalEffects.expectedHitMeanAfterResistance,
    disabled.calculation.hit.nonCriticalHitAfterResistance.mean,
  );
  assert.ok(
    disabled.calculation.supportEffects.contributions.some(
      (entry) => entry.operation === 'less-critical-strike-chance' && !entry.appliedToSelectedHit,
    ),
  );
});

test('critical rounding, caps, resistance and zero damage match fresh recomputation', () => {
  const input = structuredClone(basic);
  input.configuration.criticalStrikeMode = 'average';
  input.configuration.ailmentMode = 'excluded';
  input.skill.supports = [support()];
  input.modifiers.push(modifier('critical_strike_chance_+%', 1, 14));
  input.modifiers.push(modifier('base_critical_strike_multiplier_+', 1, 15));
  const session = value(createSelectedSkillSession(input, dataset));
  assert.equal(
    session.current.calculation.criticalEffects.unroundedChancePercent,
    6 * (1 + 1 / 100) * 0.2,
  );
  assert.equal(session.current.calculation.criticalEffects.roundedChancePercent, 1.21);
  assert.equal(session.current.calculation.criticalEffects.criticalMultiplier, 1.51);
  input.modifiers[3].value = 10000;
  assert.equal(checkUpdate(session, input).calculation.criticalEffects.chancePercent, 100);
  input.modifiers[3].value = -1000;
  assert.equal(checkUpdate(session, input).calculation.criticalEffects.chancePercent, 0);
  input.modifiers[3].value = 100;
  input.modifiers[4].value = -1000;
  assert.equal(checkUpdate(session, input).calculation.criticalEffects.criticalMultiplier, 1);
  input.configuration.effectiveLightningResistancePercent = -50;
  checkUpdate(session, input);
  input.modifiers[0].value = -130;
  const zero = checkUpdate(session, input).calculation;
  assert.equal(zero.hitDps, 0);
  assert.equal(zero.criticalEffects.expectedHitMeanAfterResistance, 0);
});

test('selected level changes refresh critical base chance while preserving modifier aggregates', () => {
  const synthetic = structuredClone(dataset);
  delete synthetic.supports;
  delete synthetic.resistance;
  delete synthetic.shock;
  delete synthetic.conductivity;
  synthetic.identity.snapshotId += '-synthetic-critical-level';
  synthetic.critical.identity = { ...synthetic.identity };
  synthetic.levels.find((level) => level.gemLevel === 1).baseCriticalStrikeChancePercent = 10;
  const input = { ...structuredClone(basic), identity: synthetic.identity };
  input.configuration.criticalStrikeMode = 'average';
  input.configuration.ailmentMode = 'excluded';
  input.modifiers.push(modifier('critical_strike_chance_+%', 100, 14));
  const session = value(createSelectedSkillSession(input, synthetic));
  input.skill.gemLevel = 1;
  const report = value(session.recalculate(input));
  assert.deepEqual(report.calculation, value(calculateSelectedSkill(input, synthetic)));
  assert.equal(report.calculation.criticalEffects.baseChancePercent, 10);
  assert.equal(report.calculation.criticalEffects.chancePercent, 20);
  assert.ok(report.recalculated.includes('base'));
  assert.ok(report.recalculated.includes('critical-effects'));
  assert.ok(!report.recalculated.includes('critical-chance-increase'));
  assert.ok(!report.recalculated.includes('critical-multiplier-increase'));
});

test('missing critical configuration/facts and unsupported critical contexts reject atomically', () => {
  const session = value(createSelectedSkillSession(basic, dataset));
  const original = session.current;
  for (const mutate of [
    (input) => {
      input.configuration.criticalStrikeMode = 'average';
    },
    (input) => {
      input.configuration.criticalStrikeMode = 'unknown';
    },
    (input) => {
      input.configuration.criticalStrikeMode = 'average';
      input.configuration.ailmentMode = 'included';
    },
    (input) => {
      input.modifiers.push(modifier('critical_strike_chance_+%', NaN, 14));
    },
    (input) => {
      input.modifiers.push(modifier('critical_strike_chance_+%', 1.5, 14));
    },
    (input) => {
      input.modifiers.push(
        modifier('base_critical_strike_multiplier_+', Number.MAX_SAFE_INTEGER, 14),
      );
    },
    (input) => {
      input.modifiers.push({
        ...modifier('spell_critical_strike_chance_+%', 10, 14),
        scope: 'local',
      });
    },
    (input) => {
      input.modifiers.push({
        ...modifier('base_critical_strike_multiplier_+', 10, 14),
        conditions: ['on-low-life'],
      });
    },
  ]) {
    const input = structuredClone(basic);
    mutate(input);
    assert.equal(calculateSelectedSkill(input, dataset).ok, false);
    assert.equal(session.recalculate(input).ok, false);
    assert.equal(session.current, original);
  }
  const unavailable = structuredClone(dataset);
  delete unavailable.critical;
  const legacy = value(createSelectedSkillSession(basic, unavailable));
  const last = legacy.current;
  const addedCrit = structuredClone(basic);
  addedCrit.modifiers.push(modifier('critical_strike_chance_+%', 10, 14));
  assert.equal(calculateSelectedSkill(addedCrit, unavailable).ok, false);
  assert.equal(legacy.recalculate(addedCrit).ok, false);
  assert.equal(legacy.current, last);
  const averaged = structuredClone(basic);
  averaged.configuration.criticalStrikeMode = 'average';
  averaged.configuration.ailmentMode = 'excluded';
  assert.equal(calculateSelectedSkill(averaged, unavailable).ok, false);
  assert.equal(legacy.recalculate(averaged).ok, false);
  assert.equal(legacy.current, last);
});

test('unsafe intermediate critical sums reject atomically before cancellation and allow recovery', () => {
  for (const statId of [
    'critical_strike_chance_+%',
    'spell_critical_strike_chance_+%',
    'base_critical_strike_multiplier_+',
  ]) {
    const initial = structuredClone(basic);
    initial.configuration.criticalStrikeMode = 'average';
    initial.configuration.ailmentMode = 'excluded';
    const session = value(createSelectedSkillSession(initial, dataset));
    for (const sign of [1, -1]) {
      const input = structuredClone(initial);
      for (const [index, amount] of [
        Number.MAX_SAFE_INTEGER * sign,
        2 * sign,
        -Number.MAX_SAFE_INTEGER * sign,
      ].entries()) {
        input.modifiers.push(modifier(statId, amount, 14 + index));
      }
      const before = session.current;
      assert.equal(calculateSelectedSkill(input, dataset).ok, false);
      assert.equal(session.recalculate(input).ok, false);
      assert.equal(session.current, before);
      const recovered = structuredClone(initial);
      recovered.modifiers.push(modifier(statId, sign === 1 ? 10 : 20, 14));
      checkUpdate(session, recovered);
    }
  }
});

test('optional critical configuration preserves explicit undefined key identity', () => {
  const input = structuredClone(basic);
  const session = value(createSelectedSkillSession(input, dataset));
  input.configuration.criticalStrikeMode = undefined;
  const modePresent = checkUpdate(session, input);
  assert.equal(Object.hasOwn(modePresent.calculation.configuration, 'criticalStrikeMode'), true);
  input.configuration.ailmentMode = undefined;
  const ailmentPresent = checkUpdate(session, input);
  assert.equal(Object.hasOwn(ailmentPresent.calculation.configuration, 'ailmentMode'), true);
  delete input.configuration.criticalStrikeMode;
  const modeRemoved = checkUpdate(session, input);
  assert.equal(Object.hasOwn(modeRemoved.calculation.configuration, 'criticalStrikeMode'), false);
  delete input.configuration.ailmentMode;
  const ailmentRemoved = checkUpdate(session, input);
  assert.equal(Object.hasOwn(ailmentRemoved.calculation.configuration, 'ailmentMode'), false);
  input.configuration.criticalStrikeMode = 'average';
  input.configuration.ailmentMode = 'excluded';
  checkUpdate(session, input);
  input.configuration.criticalStrikeMode = 'disabled';
  input.configuration.ailmentMode = undefined;
  checkUpdate(session, input);
});

test('critical inputs, pinned rule source and rows retain independent ownership', () => {
  const input = structuredClone(basic);
  input.configuration.criticalStrikeMode = 'average';
  input.configuration.ailmentMode = 'excluded';
  input.modifiers.push(modifier('critical_strike_chance_+%', 0, 14));
  const expected = structuredClone(input);
  const ownedDataset = structuredClone(dataset);
  const session = value(createSelectedSkillSession(input, ownedDataset));
  const original = structuredClone(session.current.calculation);
  input.modifiers[3].source.id = 'host-critical-modifier';
  ownedDataset.critical.sourceRows[0].key = 'host-critical-row';
  ownedDataset.critical.baseMultiplierSource.id = 'host-rule-source';
  assert.deepEqual(session.current.calculation, original);
  assert.throws(() => {
    session.current.calculation.criticalEffects.baseMultiplierSource.id = 'changed';
  }, TypeError);
  assert.throws(() => {
    session.current.calculation.criticalEffects.modifierContributions[0].source.id = 'changed';
  }, TypeError);
  expected.modifiers[3].value = -0;
  checkUpdate(session, expected);
  expected.modifiers[3].value = 100;
  checkUpdate(session, expected);
});

test('critical facts reject hidden cycles, inherited rows and mismatched source identity', () => {
  for (const select of [
    (data) => data.critical,
    (data) => data.critical.identity,
    (data) => data.critical.baseMultiplierSource,
    (data) => data.critical.sourceRows[0],
  ]) {
    const malformed = structuredClone(dataset);
    const target = select(malformed);
    target.extra = {};
    target.extra.self = target.extra;
    assert.equal(calculateSelectedSkill(basic, malformed).ok, false);
    assert.equal(createSelectedSkillSession(basic, malformed).ok, false);
  }
  for (const mutate of [
    (data) => {
      data.critical.identity.snapshotId += '-different';
    },
    (data) => {
      data.critical.sourceRows[0] = Object.create(data.critical.sourceRows[0]);
    },
    (data) => {
      delete data.critical.sourceRows[0];
    },
    (data) => {
      data.critical.baseMultiplierSource.id = 'unverified-rule';
    },
    (data) => {
      data.critical.baseMultiplierPercent = 200;
    },
  ]) {
    const malformed = structuredClone(dataset);
    mutate(malformed);
    assert.equal(calculateSelectedSkill(basic, malformed).ok, false);
    assert.equal(createSelectedSkillSession(basic, malformed).ok, false);
  }
});

test('exposure selection retains strongest membership, ties and ordered provenance', () => {
  const input = configuredInput(100, [exposure(-10), exposure(-25, false, 'exposure-2')]);
  input.modifiers.push(modifier('base_reduce_enemy_lightning_resistance_%', 15, 17));
  const session = value(createSelectedSkillSession(input, dataset));
  assert.deepEqual(session.current.calculation, value(calculateSelectedSkill(input, dataset)));
  const first = session.current.calculation.resistanceEffects;
  assert.equal(first.profile, 'configured');
  assert.equal(first.exposurePercent, -10);
  assert.equal(first.uncappedResistancePercent, 90);
  assert.equal(first.maximumResistancePercent, 90);
  assert.equal(first.cappedResistancePercent, 90);
  assert.equal(first.effectiveResistancePercent, 75);
  assert.deepEqual(first.selectedExposureIndices, [0]);
  const raw = input.configuration.lightningResistance;
  raw.baseResistancePercent = 80;
  const baseChanged = checkUpdate(session, input);
  assert.equal(baseChanged.calculation.resistanceEffects.effectiveResistancePercent, 55);
  assert.ok(!baseChanged.recalculated.includes('lightning-exposure'));
  assert.ok(!baseChanged.recalculated.includes('damage-before-resistance'));
  assert.ok(!baseChanged.recalculated.includes('cast-rate'));
  raw.exposures[0].value = -30;
  assert.equal(
    checkUpdate(session, input).calculation.resistanceEffects.effectiveResistancePercent,
    35,
  );
  raw.exposures[1].enabled = true;
  checkUpdate(session, input);
  raw.exposures[1].value = -40;
  assert.deepEqual(
    checkUpdate(session, input).calculation.resistanceEffects.selectedExposureIndices,
    [1],
  );
  raw.exposures[1].enabled = false;
  checkUpdate(session, input);
  raw.exposures.push(exposure(-30, true, 'exposure-3'));
  const tied = checkUpdate(session, input);
  assert.deepEqual(tied.calculation.resistanceEffects.selectedExposureIndices, [0, 2]);
  assert.equal(tied.calculation.resistanceEffects.exposurePercent, -30);
  assert.equal(tied.calculation.resistanceEffects.effectiveResistancePercent, 35);
  raw.exposures.splice(0, 1);
  const removed = checkUpdate(session, input);
  assert.deepEqual(removed.calculation.resistanceEffects.selectedExposureIndices, [1]);
  assert.deepEqual(removed.dependencies['lightning-exposure'], ['exposure:0', 'exposure:1']);
  raw.exposures = [];
  const none = checkUpdate(session, input);
  assert.equal(none.calculation.resistanceEffects.exposurePercent, 0);
  assert.equal(none.calculation.resistanceEffects.effectiveResistancePercent, 65);
  assert.deepEqual(none.dependencies['lightning-exposure'], []);
  raw.source.id = 'moved-resistance-source';
  assert.deepEqual(checkUpdate(session, input).recalculated, [
    'resistance-effects',
    'selected-skill',
  ]);
});

test('resistance cap/floor precede penetration for both normal and critical damage', () => {
  const input = configuredInput(1000);
  input.configuration.criticalStrikeMode = 'average';
  input.configuration.ailmentMode = 'excluded';
  input.skill.supports = [support()];
  input.modifiers.push(modifier('base_reduce_enemy_lightning_resistance_%', 20, 17));
  const session = value(createSelectedSkillSession(input, dataset));
  assert.equal(session.current.calculation.resistanceEffects.cappedResistancePercent, 90);
  assert.equal(session.current.calculation.resistanceEffects.effectiveResistancePercent, 70);
  const raw = input.configuration.lightningResistance;
  raw.maximumResistanceMode = 'default75';
  const defaultCap = checkUpdate(session, input);
  assert.equal(defaultCap.calculation.resistanceEffects.cappedResistancePercent, 75);
  assert.equal(defaultCap.calculation.resistanceEffects.effectiveResistancePercent, 55);
  assert.ok(!defaultCap.recalculated.includes('uncapped-resistance'));
  raw.baseResistancePercent = -195;
  raw.exposures = [exposure(-10)];
  const belowFloor = checkUpdate(session, input).calculation;
  assert.equal(belowFloor.resistanceEffects.uncappedResistancePercent, -205);
  assert.equal(belowFloor.resistanceEffects.cappedResistancePercent, -200);
  assert.equal(belowFloor.resistanceEffects.effectiveResistancePercent, -220);
  assert.equal(belowFloor.hit.effectiveLightningResistancePercent, -220);
  assert.equal(
    belowFloor.hit.nonCriticalHitAfterResistance.mean,
    belowFloor.hit.nonCriticalHitBeforeResistance.mean * 3.2,
  );
  assert.equal(
    belowFloor.criticalEffects.criticalHitAfterResistance.mean,
    belowFloor.criticalEffects.criticalHitBeforeResistance.mean * 3.2,
  );
  input.modifiers[3].value = 30;
  const changed = checkUpdate(session, input);
  assert.equal(changed.calculation.resistanceEffects.effectiveResistancePercent, -230);
  assert.deepEqual(changed.recalculated, [
    'lightning-penetration',
    'effective-resistance',
    'resistance-effects',
    'damage-after-resistance',
    'critical-effects',
    'shock-effects',
    'selected-skill',
  ]);
  input.modifiers[0].statId = 'base_reduce_enemy_lightning_resistance_%';
  const reclassified = checkUpdate(session, input);
  assert.deepEqual(reclassified.dependencies['lightning-penetration'], [
    'modifier:0',
    'modifier:3',
  ]);
  assert.deepEqual(reclassified.dependencies['damage-increase'], ['modifier:1']);
  input.modifiers[3].statId = 'critical_strike_chance_+%';
  const intoCritical = checkUpdate(session, input);
  assert.deepEqual(intoCritical.dependencies['lightning-penetration'], ['modifier:0']);
  assert.deepEqual(intoCritical.dependencies['critical-chance-increase'], ['modifier:3']);
  input.modifiers.splice(0, 1);
  const noPenetration = checkUpdate(session, input);
  assert.deepEqual(noPenetration.dependencies['lightning-penetration'], []);
  assert.equal(noPenetration.calculation.resistanceEffects.effectiveResistancePercent, -200);
  input.configuration.criticalStrikeMode = 'disabled';
  assert.deepEqual(checkUpdate(session, input).recalculated, [
    'critical-effects',
    'shock-effects',
    'selected-skill',
  ]);
});

test('configured resistance rejects ambiguous profiles and unsupported mechanics atomically', () => {
  const initial = configuredInput(50, [exposure(-10)]);
  const session = value(createSelectedSkillSession(initial, dataset));
  const original = session.current;
  for (const mutate of [
    (input) => {
      input.configuration.effectiveLightningResistancePercent = 25;
    },
    (input) => {
      input.configuration.effectiveLightningResistancePercent = undefined;
    },
    (input) => {
      input.configuration.lightningResistance.baseResistancePercent = 1001;
    },
    (input) => {
      input.configuration.lightningResistance.baseResistancePercent = -1001;
    },
    (input) => {
      input.configuration.lightningResistance.maximumResistanceMode = 'inferred';
    },
    (input) => {
      delete input.configuration.lightningResistance.source;
    },
    (input) => {
      delete input.configuration.lightningResistance.exposures;
    },
    (input) => {
      input.configuration.lightningResistance.exposures = Array.from({ length: 9 }, () =>
        exposure(),
      );
    },
    (input) => {
      input.configuration.lightningResistance.exposures[0].value = 10;
    },
    (input) => {
      input.configuration.lightningResistance.exposures[0].value = -101;
    },
    (input) => {
      input.configuration.lightningResistance.exposures[0].value = -0.5;
    },
    (input) => {
      input.configuration.lightningResistance.exposures[0].enabled = 'false';
    },
    (input) => {
      input.configuration.lightningResistance.exposures[0].statId = 'display-lightning-exposure';
    },
    (input) => {
      input.configuration.lightningResistance.exposures[0].source.kind = 'item';
    },
    (input) => {
      input.modifiers.push(modifier('base_reduce_enemy_lightning_resistance_%', 201, 17));
    },
    (input) => {
      input.modifiers.push(modifier('base_reduce_enemy_lightning_resistance_%', -1, 17));
    },
    (input) => {
      input.modifiers.push(modifier('base_reduce_enemy_lightning_resistance_%', 1.5, 17));
    },
    (input) => {
      input.modifiers.push(
        modifier('base_reduce_enemy_lightning_resistance_%', 200, 17),
        modifier('base_reduce_enemy_lightning_resistance_%', 1, 18),
      );
    },
    (input) => {
      input.modifiers.push(modifier('reduce_enemy_lightning_resistance_%', 10, 17));
    },
    (input) => {
      input.modifiers.push(modifier('lightning_exposure_on_hit_magnitude', -10, 17));
    },
    (input) => {
      delete input.configuration.lightningResistance.exposures[0];
    },
    (input) => {
      input.configuration.lightningResistance.source = Object.create(
        input.configuration.lightningResistance.source,
      );
    },
  ]) {
    const input = structuredClone(initial);
    mutate(input);
    assert.equal(calculateSelectedSkill(input, dataset).ok, false);
    assert.equal(session.recalculate(input).ok, false);
    assert.equal(session.current, original);
  }
  for (const amount of [0, 10]) {
    const legacy = structuredClone(basic);
    legacy.modifiers.push(modifier('base_reduce_enemy_lightning_resistance_%', amount, 17));
    assert.equal(calculateSelectedSkill(legacy, dataset).ok, false);
    assert.equal(session.recalculate(legacy).ok, false);
    assert.equal(session.current, original);
  }
  const unavailable = structuredClone(dataset);
  delete unavailable.resistance;
  const legacy = value(createSelectedSkillSession(basic, unavailable));
  const before = legacy.current;
  assert.equal(calculateSelectedSkill(initial, unavailable).ok, false);
  assert.equal(legacy.recalculate(initial).ok, false);
  assert.equal(legacy.current, before);
  const recovered = structuredClone(basic);
  recovered.configuration.effectiveLightningResistancePercent = 50;
  assert.deepEqual(
    value(legacy.recalculate(recovered)).calculation,
    value(calculateSelectedSkill(recovered, unavailable)),
  );
});

test('resistance profile transitions and captured exposure/rule ownership match fresh results', () => {
  const input = configuredInput(80, [exposure(-10), exposure(-25, false, 'exposure-2')]);
  input.modifiers.push(modifier('base_reduce_enemy_lightning_resistance_%', 10, 17));
  const expected = structuredClone(input);
  const ownedDataset = structuredClone(dataset);
  const session = value(createSelectedSkillSession(input, ownedDataset));
  const original = structuredClone(session.current.calculation);
  input.configuration.lightningResistance.source.id = 'host-config-mutated';
  input.configuration.lightningResistance.exposures[0].source.id = 'host-exposure-mutated';
  ownedDataset.resistance.ruleSource.id = 'host-rule-mutated';
  ownedDataset.resistance.sourceRows[0].key = 'host-row-mutated';
  assert.deepEqual(session.current.calculation, original);
  assert.throws(() => {
    session.current.calculation.resistanceEffects.exposureContributions[0].source.id = 'mutated';
  }, TypeError);
  assert.throws(() => {
    session.current.calculation.resistanceEffects.ruleSource.id = 'mutated';
  }, TypeError);
  expected.configuration.lightningResistance.exposures[1].enabled = true;
  checkUpdate(session, expected);
  const legacy = structuredClone(basic);
  const switched = checkUpdate(session, legacy);
  assert.equal(switched.calculation.resistanceEffects.profile, 'effective');
  assert.equal(switched.calculation.resistanceEffects.maximumResistancePercent, null);
  assert.equal(switched.calculation.resistanceEffects.minimumResistancePercent, null);
  assert.deepEqual(switched.dependencies['lightning-exposure'], []);
  assert.deepEqual(switched.dependencies['lightning-penetration'], []);
  checkUpdate(session, expected);
});

test('resistance facts reject hidden cycles, inherited identities and wrong stat provenance', () => {
  for (const select of [
    (data) => data.resistance,
    (data) => data.resistance.identity,
    (data) => data.resistance.ruleSource,
    (data) => data.resistance.sourceRows[0],
  ]) {
    const malformed = structuredClone(dataset);
    const target = select(malformed);
    target.extra = {};
    target.extra.self = target.extra;
    assert.equal(calculateSelectedSkill(basic, malformed).ok, false);
    assert.equal(createSelectedSkillSession(basic, malformed).ok, false);
  }
  for (const mutate of [
    (data) => {
      data.resistance.identity.snapshotId += '-different';
    },
    (data) => {
      data.resistance.identity = Object.create(data.resistance.identity);
    },
    (data) => {
      data.resistance.sourceRows[0] = Object.create(data.resistance.sourceRows[0]);
    },
    (data) => {
      delete data.resistance.sourceRows[0];
    },
    (data) => {
      data.resistance.sourceRows[0].key = 'reduce_enemy_lightning_resistance_%';
    },
    (data) => {
      data.resistance.ruleSource.id = 'unverified-resistance-rule';
    },
  ]) {
    const malformed = structuredClone(dataset);
    mutate(malformed);
    assert.equal(calculateSelectedSkill(basic, malformed).ok, false);
    assert.equal(createSelectedSkillSession(basic, malformed).ok, false);
  }
});

test('configured resistance keeps signed-zero candidate and penetration provenance', () => {
  const input = configuredInput(0, [exposure(0)]);
  input.modifiers.push(modifier('base_reduce_enemy_lightning_resistance_%', 0, 17));
  const session = value(createSelectedSkillSession(input, dataset));
  input.configuration.lightningResistance.baseResistancePercent = -0;
  checkUpdate(session, input);
  input.configuration.lightningResistance.exposures[0].value = -0;
  checkUpdate(session, input);
  input.modifiers[3].value = -0;
  checkUpdate(session, input);
});

test('inherited conflicting resistance profiles reject atomically and recover with fresh parity', () => {
  const initial = configuredInput(50, [exposure(-10)]);
  const session = value(createSelectedSkillSession(initial, dataset));
  const candidates = [];
  const inheritedNull = structuredClone(basic);
  Object.setPrototypeOf(inheritedNull.configuration, { lightningResistance: null });
  candidates.push(inheritedNull);
  const inheritedRaw = structuredClone(basic);
  Object.setPrototypeOf(inheritedRaw.configuration, {
    lightningResistance: structuredClone(initial.configuration.lightningResistance),
  });
  candidates.push(inheritedRaw);
  const inheritedEffective = structuredClone(initial);
  Object.setPrototypeOf(inheritedEffective.configuration, {
    effectiveLightningResistancePercent: 25,
  });
  candidates.push(inheritedEffective);
  const inheritedNullEffective = structuredClone(initial);
  Object.setPrototypeOf(inheritedNullEffective.configuration, {
    effectiveLightningResistancePercent: null,
  });
  candidates.push(inheritedNullEffective);
  for (const [index, input] of candidates.entries()) {
    const before = session.current;
    assert.equal(calculateSelectedSkill(input, dataset).ok, false);
    assert.equal(createSelectedSkillSession(input, dataset).ok, false);
    assert.equal(session.recalculate(input).ok, false);
    assert.equal(session.current, before);
    const recovered = structuredClone(initial);
    recovered.configuration.lightningResistance.baseResistancePercent = 60 + index;
    checkUpdate(session, recovered);
  }
});

test('configured shock magnitude, uptime and source change only shock effects and result', () => {
  const input = structuredClone(basic);
  input.configuration.ailmentMode = 'configured-shock';
  input.configuration.shock = shock();
  const session = value(createSelectedSkillSession(input, dataset));
  assert.deepEqual(session.current.calculation, value(calculateSelectedSkill(input, dataset)));
  const first = session.current.calculation;
  assert.equal(first.shockEffects.mode, 'configured');
  assert.equal(first.shockEffects.shockedDamageMultiplier, 1.2);
  assert.equal(first.shockEffects.averageDamageMultiplier, 1.2);
  assert.equal(
    first.shockEffects.unshockedHitMeanAfterResistance,
    first.criticalEffects.expectedHitMeanAfterResistance,
  );
  assert.equal(
    first.shockEffects.shockedHitMeanAfterResistance,
    first.shockEffects.unshockedHitMeanAfterResistance * 1.2,
  );
  input.configuration.shock.magnitudePercent = 50;
  const maximum = checkUpdate(session, input);
  assert.deepEqual(maximum.recalculated, ['shock-effects', 'selected-skill']);
  input.configuration.shock.uptimePercent = 25;
  const partial = checkUpdate(session, input);
  assert.deepEqual(partial.recalculated, ['shock-effects', 'selected-skill']);
  assert.equal(partial.calculation.shockEffects.averageDamageMultiplier, 1.125);
  const effects = partial.calculation.shockEffects;
  assert.ok(
    Math.abs(
      effects.expectedHitMeanAfterShock -
        (effects.unshockedHitMeanAfterResistance * 0.75 +
          effects.shockedHitMeanAfterResistance * 0.25),
    ) <= 1e-9,
  );
  input.configuration.shock.source.id = 'moved-shock-source';
  const moved = checkUpdate(session, input);
  assert.deepEqual(moved.recalculated, ['shock-effects', 'selected-skill']);
  assert.equal(moved.calculation.shockEffects.contributions[0].source.id, 'moved-shock-source');
  input.configuration.shock.uptimePercent = 0;
  const noUptime = checkUpdate(session, input).calculation;
  assert.equal(noUptime.shockEffects.averageDamageMultiplier, 1);
  assert.equal(
    noUptime.shockEffects.expectedHitMeanAfterShock,
    noUptime.criticalEffects.expectedHitMeanAfterResistance,
  );
  input.configuration.shock.magnitudePercent = 0;
  input.configuration.shock.uptimePercent = 100;
  const zeroMagnitude = checkUpdate(session, input).calculation;
  assert.equal(zeroMagnitude.shockEffects.shockedDamageMultiplier, 1);
  assert.equal(
    zeroMagnitude.shockEffects.expectedHitMeanAfterShock,
    zeroMagnitude.criticalEffects.expectedHitMeanAfterResistance,
  );
  delete input.configuration.shock;
  input.configuration.ailmentMode = 'excluded';
  const excluded = checkUpdate(session, input);
  assert.deepEqual(excluded.recalculated, ['shock-effects', 'selected-skill']);
  assert.equal(excluded.calculation.shockEffects.mode, 'excluded');
  assert.deepEqual(excluded.calculation.shockEffects.contributions, []);
});

test('shock shares post-resistance critical results while cast-only edits reuse shock means', () => {
  const input = configuredInput(-195, [exposure(-10)]);
  input.configuration.criticalStrikeMode = 'average';
  input.configuration.ailmentMode = 'configured-shock';
  input.configuration.shock = shock(30, 40);
  input.skill.supports = [support()];
  input.addedLightningDamage = [added(2, 8)];
  input.modifiers.push(modifier('critical_strike_chance_+%', 100, 14));
  input.modifiers.push(modifier('base_critical_strike_multiplier_+', 50, 15));
  input.modifiers.push(modifier('base_reduce_enemy_lightning_resistance_%', 20, 16));
  const session = value(createSelectedSkillSession(input, dataset));
  assert.deepEqual(session.current.calculation, value(calculateSelectedSkill(input, dataset)));
  assert.equal(session.current.calculation.resistanceEffects.effectiveResistancePercent, -220);
  const originalShock = session.current.calculation.shockEffects;
  input.modifiers[2].value = 35;
  const faster = checkUpdate(session, input);
  assert.deepEqual(faster.recalculated, ['cast-speed-increase', 'cast-rate', 'selected-skill']);
  assert.deepEqual(faster.calculation.shockEffects, originalShock);
  input.configuration.criticalStrikeMode = 'disabled';
  const disabledCritical = checkUpdate(session, input);
  assert.deepEqual(disabledCritical.recalculated, [
    'critical-effects',
    'shock-effects',
    'selected-skill',
  ]);
  input.configuration.criticalStrikeMode = 'average';
  checkUpdate(session, input);
  input.skill.supports[0].enabled = false;
  const noSupport = checkUpdate(session, input);
  assert.ok(noSupport.recalculated.includes('shock-effects'));
  assert.ok(!noSupport.recalculated.includes('effective-resistance'));
  input.modifiers[5].value = 30;
  const morePenetration = checkUpdate(session, input);
  assert.equal(morePenetration.calculation.resistanceEffects.effectiveResistancePercent, -230);
  assert.ok(morePenetration.recalculated.includes('shock-effects'));
  assert.ok(!morePenetration.recalculated.includes('damage-before-resistance'));
  input.modifiers[0].value = -130;
  const zeroDamage = checkUpdate(session, input).calculation;
  assert.equal(zeroDamage.shockEffects.expectedHitMeanAfterShock, 0);
  assert.equal(zeroDamage.hitDps, 0);
});

test('shock scenarios reject unsupported inference, bounds and inherited configuration atomically', () => {
  const initial = structuredClone(basic);
  const session = value(createSelectedSkillSession(initial, dataset));
  const before = session.current;
  const base = structuredClone(basic);
  base.configuration.ailmentMode = 'configured-shock';
  base.configuration.shock = shock();
  for (const mutate of [
    (input) => {
      input.configuration.ailmentMode = 'excluded';
    },
    (input) => {
      delete input.configuration.shock;
    },
    (input) => {
      input.configuration.shock = null;
    },
    (input) => {
      input.configuration.shock.magnitudePercent = -1;
    },
    (input) => {
      input.configuration.shock.magnitudePercent = 51;
    },
    (input) => {
      input.configuration.shock.magnitudePercent = 1.5;
    },
    (input) => {
      input.configuration.shock.uptimePercent = -1;
    },
    (input) => {
      input.configuration.shock.uptimePercent = 101;
    },
    (input) => {
      input.configuration.shock.uptimePercent = 0.5;
    },
    (input) => {
      input.configuration.shock.source.kind = 'item';
    },
    (input) => {
      input.configuration.shock.source = Object.create(input.configuration.shock.source);
    },
    (input) => {
      input.configuration.shock.chancePercent = 50;
    },
    (input) => {
      const state = input.configuration.shock;
      delete input.configuration.shock;
      Object.setPrototypeOf(input.configuration, { shock: state });
    },
    (input) => {
      delete input.configuration.shock;
      Object.setPrototypeOf(input.configuration, { shock: null });
    },
    (input) => {
      input.modifiers.push(modifier('shock_effect_+%', 10, 17));
    },
    (input) => {
      input.modifiers.push(modifier('base_damage_taken_+%_from_shock', 10, 17));
    },
  ]) {
    const input = structuredClone(base);
    mutate(input);
    assert.equal(calculateSelectedSkill(input, dataset).ok, false);
    assert.equal(createSelectedSkillSession(input, dataset).ok, false);
    assert.equal(session.recalculate(input).ok, false);
    assert.equal(session.current, before);
  }
  checkUpdate(session, base);
  const unavailable = structuredClone(dataset);
  delete unavailable.shock;
  const legacy = value(createSelectedSkillSession(basic, unavailable));
  const last = legacy.current;
  assert.equal(calculateSelectedSkill(base, unavailable).ok, false);
  assert.equal(legacy.recalculate(base).ok, false);
  assert.equal(legacy.current, last);
  const recovered = structuredClone(basic);
  recovered.configuration.effectiveLightningResistancePercent = 50;
  assert.deepEqual(
    value(legacy.recalculate(recovered)).calculation,
    value(calculateSelectedSkill(recovered, unavailable)),
  );
});

test('shock scenario, normalized facts and trace retain independent ownership', () => {
  const input = structuredClone(basic);
  input.configuration.ailmentMode = 'configured-shock';
  input.configuration.shock = shock();
  const expected = structuredClone(input);
  const ownedDataset = structuredClone(dataset);
  const session = value(createSelectedSkillSession(input, ownedDataset));
  const original = structuredClone(session.current.calculation);
  input.configuration.shock.source.id = 'host-shock-source';
  input.configuration.shock.magnitudePercent = 50;
  ownedDataset.shock.ruleSource.id = 'host-shock-rule';
  ownedDataset.shock.sourceRows[0].key = 'host-shock-row';
  assert.deepEqual(session.current.calculation, original);
  assert.throws(() => {
    session.current.calculation.shockEffects.contributions[0].source.id = 'changed';
  }, TypeError);
  assert.throws(() => {
    session.current.calculation.shockEffects.ruleSource.id = 'changed';
  }, TypeError);
  expected.configuration.shock.magnitudePercent = 0;
  checkUpdate(session, expected);
  expected.configuration.shock.magnitudePercent = -0;
  expected.configuration.shock.uptimePercent = -0;
  checkUpdate(session, expected);
});

test('shock facts reject cycles, inherited metadata, sparse rows and mismatched identity', () => {
  for (const select of [
    (data) => data.shock,
    (data) => data.shock.identity,
    (data) => data.shock.ruleSource,
    (data) => data.shock.sourceRows[0],
  ]) {
    const malformed = structuredClone(dataset);
    const target = select(malformed);
    target.extra = {};
    target.extra.self = target.extra;
    assert.equal(calculateSelectedSkill(basic, malformed).ok, false);
    assert.equal(createSelectedSkillSession(basic, malformed).ok, false);
  }
  for (const mutate of [
    (data) => {
      data.shock.identity.snapshotId += '-different';
    },
    (data) => {
      data.shock.sourceRows[0] = Object.create(data.shock.sourceRows[0]);
    },
    (data) => {
      delete data.shock.sourceRows[0];
    },
    (data) => {
      data.shock.ruleSource.id = 'unverified-shock-rule';
    },
  ]) {
    const malformed = structuredClone(dataset);
    mutate(malformed);
    assert.equal(calculateSelectedSkill(basic, malformed).ok, false);
    assert.equal(createSelectedSkillSession(basic, malformed).ok, false);
  }
});

test('invalid added-lightning groups fail atomically and retain the accepted dependency set', () => {
  const input = { ...structuredClone(basic), addedLightningDamage: [added(2, 8)] };
  const session = value(createSelectedSkillSession(input, dataset));
  const original = session.current;
  for (const mutate of [
    (next) => {
      next.addedLightningDamage[0].values = [-1, 8];
    },
    (next) => {
      next.addedLightningDamage[0].values = [9, 8];
    },
    (next) => {
      next.addedLightningDamage[0].values = [NaN, 8];
    },
    (next) => {
      next.addedLightningDamage[0].values = [0.5, 8];
    },
    (next) => {
      next.addedLightningDamage[0].values = [2];
    },
    (next) => {
      next.addedLightningDamage[0].statIds.reverse();
    },
    (next) => {
      next.addedLightningDamage[0].conditions = ['on-low-life'];
    },
    (next) => {
      next.addedLightningDamage[0].scope = 'local';
    },
    (next) => {
      next.addedLightningDamage[0].source.line = 0;
    },
    (next) => {
      next.addedLightningDamage[0].more = 5;
    },
    (next) => {
      next.addedLightningDamage = [
        added(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
        added(1, 1),
      ];
    },
  ]) {
    const next = structuredClone(input);
    mutate(next);
    assert.equal(calculateSelectedSkill(next, dataset).ok, false);
    assert.equal(session.recalculate(next).ok, false);
    assert.equal(session.current, original);
  }
  const recovered = structuredClone(input);
  recovered.addedLightningDamage[0].values = [0, 0];
  checkUpdate(session, recovered);
  assert.throws(() => {
    session.current.calculation.addedLightningDamage.contributions[0].values[0] = 1;
  }, TypeError);
});

test('scaled-added and combined-base overflow reject atomically before publishing output', () => {
  for (const combinedOverflow of [false, true]) {
    const synthetic = structuredClone(dataset);
    delete synthetic.supports;
    delete synthetic.critical;
    delete synthetic.resistance;
    delete synthetic.shock;
    delete synthetic.conductivity;
    synthetic.identity.snapshotId += combinedOverflow ? '-combined-overflow' : '-scaled-overflow';
    const level = synthetic.levels.find((entry) => entry.gemLevel === 20);
    level.addedDamageEffectiveness = combinedOverflow ? 1e307 : 1e308;
    if (combinedOverflow) {
      level.baseLightningMin = 0;
      level.baseLightningMax = 5e307;
    }
    const input = { ...structuredClone(basic), identity: synthetic.identity };
    const session = value(createSelectedSkillSession(input, synthetic));
    const original = session.current;
    input.addedLightningDamage = [added(0, combinedOverflow ? 16 : 2)];
    assert.equal(calculateSelectedSkill(input, synthetic).ok, false);
    assert.equal(session.recalculate(input).ok, false);
    assert.equal(session.current, original);
  }
});

test('skill/quality, rounding, rate cap, duplicate contributions and provenance stay identical', () => {
  const input = structuredClone(basic);
  const session = value(createSelectedSkillSession(input, dataset));
  input.skill.gemLevel = 1;
  assert.ok(checkUpdate(session, input).recalculated.includes('base'));
  input.skill.quality = 20;
  checkUpdate(session, input);
  input.modifiers[0].value = 1.37;
  input.modifiers[1].value = 2.18;
  input.modifiers[2].value = 0.1234;
  checkUpdate(session, input);
  input.modifiers[2].value = 10000;
  const capped = checkUpdate(session, input).calculation;
  assert.equal(capped.hit.castsPerSecond, 1 / 0.033);
  input.modifiers.push(modifier('spell_damage_+%', 10, 7));
  checkUpdate(session, input);
  input.modifiers[0].source.label = 'changed provenance';
  const updated = checkUpdate(session, input).calculation;
  assert.equal(updated.hit.modifierContributions[0].source.label, 'changed provenance');
  input.skill.supports = undefined;
  checkUpdate(session, input);
  input.modifiers[0].source.label = undefined;
  checkUpdate(session, input);
});

test('invalid updates are atomic and recovery uses the last accepted graph', () => {
  const session = value(createSelectedSkillSession(basic, dataset));
  const original = session.current;
  for (const mutate of [
    (input) => {
      input.configuration = undefined;
    },
    (input) => {
      input.identity.snapshotId = 'different';
    },
    (input) => {
      input.modifiers[0].conditions = ['on-low-life'];
    },
    (input) => {
      input.modifiers[0].statId = 'unknown';
    },
    (input) => {
      input.modifiers[2].value = -100;
    },
    (input) => {
      input.modifiers[0].value = Number.MAX_VALUE;
    },
  ]) {
    const input = structuredClone(basic);
    mutate(input);
    assert.equal(session.recalculate(input).ok, false);
    assert.equal(session.current, original);
  }
  const valid = structuredClone(basic);
  valid.configuration.effectiveLightningResistancePercent = 50;
  checkUpdate(session, valid);
});

test('session captures input/dataset ownership and exposes immutable reports', () => {
  const input = structuredClone(basic);
  input.addedLightningDamage = [added(2, 8)];
  const ownedDataset = structuredClone(dataset);
  const session = value(createSelectedSkillSession(input, ownedDataset));
  const original = structuredClone(session.current.calculation);
  input.modifiers[0].value = 999;
  input.addedLightningDamage[0].values[0] = 999;
  input.addedLightningDamage[0].source.id = 'host-owned-added-mutation';
  ownedDataset.levels[19].baseLightningMax = 999;
  ownedDataset.levels[19].addedDamageEffectiveness = 999;
  ownedDataset.sourceRows[0].key = 'host-owned-mutation';
  ownedDataset.levels[19].sourceRows[0].key = 'host-owned-level-mutation';
  assert.deepEqual(session.current.calculation, original);
  assert.throws(() => {
    session.current.calculation.hit.baseLightningDamage.max = 1;
  }, TypeError);
  assert.throws(() => {
    session.current.dependencies['damage-increase'].push('arbitrary');
  }, TypeError);
  checkUpdate(session, basic);
});

test('unrecognized cyclic dataset metadata and partial capability lists fail as diagnostics', () => {
  for (const select of [
    (data) => data,
    (data) => data.identity,
    (data) => data.levels[19],
    (data) => data.qualityStats[0],
    (data) => data.sourceRows[0],
    (data) => data.levels[19].sourceRows[0],
    (data) => data.qualityStats[0].sourceRows[0],
  ]) {
    const malformed = structuredClone(dataset);
    const target = select(malformed);
    target.extra = {};
    target.extra.self = target.extra;
    assert.equal(calculateSelectedSkill(basic, malformed).ok, false);
    assert.equal(createSelectedSkillSession(basic, malformed).ok, false);
  }
  const partial = structuredClone(dataset);
  partial.supportedModifierStatIds.pop();
  const emptyModifiers = { ...basic, modifiers: [] };
  assert.equal(calculateSelectedSkill(emptyModifiers, partial).ok, false);
  assert.equal(createSelectedSkillSession(emptyModifiers, partial).ok, false);
  for (const [select, index] of [
    [(data) => data.levels, 0],
    [(data) => data.levels, 19],
    [(data) => data.qualityStats, 0],
    [(data) => data.sourceRows, 0],
    [(data) => data.levels[19].sourceRows, 0],
    [(data) => data.qualityStats[0].sourceRows, 0],
    [(data) => data.ruleProvenance, 0],
    [(data) => data.supportedModifierStatIds, 0],
  ]) {
    const sparse = structuredClone(dataset);
    delete select(sparse)[index];
    assert.equal(calculateSelectedSkill(basic, sparse).ok, false);
    assert.equal(createSelectedSkillSession(basic, sparse).ok, false);
  }
});

test('inherited source rows and grouped source identities fail at the shared boundary', () => {
  const inheritedRows = structuredClone(dataset);
  inheritedRows.sourceRows[0] = Object.create(inheritedRows.sourceRows[0]);
  assert.equal(calculateSelectedSkill(basic, inheritedRows).ok, false);
  assert.equal(createSelectedSkillSession(basic, inheritedRows).ok, false);
  const input = { ...structuredClone(basic), addedLightningDamage: [added(2, 8)] };
  input.addedLightningDamage[0].source = Object.create(input.addedLightningDamage[0].source);
  assert.equal(calculateSelectedSkill(input, dataset).ok, false);
  assert.equal(createSelectedSkillSession(input, dataset).ok, false);
});

test('inherited required build, skill, configuration and snapshot fields fail before cloning', () => {
  const inherit = (target, key) => {
    const inherited = target[key];
    delete target[key];
    Object.setPrototypeOf(target, { [key]: inherited });
  };
  for (const withSupport of [false, true]) {
    for (const mutate of [
      (input) => inherit(input, 'buildId'),
      (input) => inherit(input.skill, 'id'),
      (input) => inherit(input.configuration, 'id'),
      (input) => inherit(input.identity, 'snapshotId'),
    ]) {
      const input = structuredClone(basic);
      if (withSupport) input.skill.supports = [support()];
      mutate(input);
      assert.equal(calculateSelectedSkill(input, dataset).ok, false);
      assert.equal(createSelectedSkillSession(input, dataset).ok, false);
    }
  }
});

test('deterministic mutation batches compare every intermediate and final result to fresh work', () => {
  const input = structuredClone(basic);
  const session = value(createSelectedSkillSession(input, dataset));
  for (let index = 0; index < 80; index++) {
    switch (index % 5) {
      case 0:
        input.modifiers[0].value = index * 0.37;
        break;
      case 1:
        input.configuration.effectiveLightningResistancePercent = index % 91;
        break;
      case 2:
        input.modifiers[0].statId =
          input.modifiers[0].statId === 'spell_damage_+%'
            ? 'base_cast_speed_+%'
            : 'spell_damage_+%';
        break;
      case 3:
        input.skill.gemLevel = 1 + (index % 40);
        break;
      case 4:
        input.modifiers[0].source.line = index + 1;
        break;
    }
    checkUpdate(session, input);
  }
});

test('signed zero changes retain exact configuration and modifier provenance', () => {
  const input = structuredClone(basic);
  input.configuration.effectiveLightningResistancePercent = 0;
  input.modifiers[0].value = 0;
  const session = value(createSelectedSkillSession(input, dataset));
  input.configuration.effectiveLightningResistancePercent = -0;
  assert.ok(checkUpdate(session, input).recalculated.includes('selected-skill'));
  input.modifiers[0].value = -0;
  assert.ok(checkUpdate(session, input).recalculated.includes('selected-skill'));
  input.skill.quality = -0;
  assert.ok(checkUpdate(session, input).recalculated.includes('selected-skill'));
  input.addedLightningDamage = [added(0, 0)];
  checkUpdate(session, input);
  input.addedLightningDamage[0].values[0] = -0;
  assert.ok(checkUpdate(session, input).recalculated.includes('selected-skill'));
  for (const line of [0, -0]) {
    input.modifiers[0].source.line = line;
    assert.equal(calculateSelectedSkill(input, dataset).ok, false);
    assert.equal(session.recalculate(input).ok, false);
  }
});

test('graph planner explicitly rejects feedback, dependent feedback and malformed references', () => {
  assert.deepEqual(value(planCalculationGraph({ input: [], hit: ['input'], dps: ['hit'] })), [
    'input',
    'hit',
    'dps',
  ]);
  for (const graph of [
    { hit: ['hit'] },
    { damage: ['leech'], leech: ['damage'], output: ['damage'] },
  ]) {
    const result = planCalculationGraph(graph);
    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].code, 'graph.feedback-unsupported');
  }
  for (const graph of [{ output: ['missing'] }, { input: [], output: ['input', 'input'] }, null]) {
    assert.equal(planCalculationGraph(graph).ok, false);
  }
  const specialNames = Object.fromEntries([
    ['__proto__', []],
    ['constructor', ['__proto__']],
    ['toString', ['constructor']],
  ]);
  assert.deepEqual(value(planCalculationGraph(specialNames)), [
    '__proto__',
    'constructor',
    'toString',
  ]);
  assert.equal(planCalculationGraph({ output: ['toString'] }).ok, false);
  assert.equal(planCalculationGraph({ input: Array(16385) }).diagnostics[0].code, 'graph.limit');
});
