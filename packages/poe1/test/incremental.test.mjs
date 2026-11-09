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
assert.equal(loaded.ok, true);
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
    'selected-skill',
  ]);
  input.configuration.effectiveLightningResistancePercent = -25;
  assert.deepEqual(checkUpdate(session, input).recalculated, [
    'damage-after-resistance',
    'selected-skill',
  ]);
  input.configuration.id = 'enemy-2';
  assert.deepEqual(checkUpdate(session, input).recalculated, ['selected-skill']);
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
