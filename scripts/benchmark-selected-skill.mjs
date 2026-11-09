import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  calculateSelectedSkill,
  createSelectedSkillSession,
  loadSparkDataset,
  selectedSkillEngineRevision,
} from '@exile-engine/poe1';
import { fixtureReader } from '../packages/core/test/fixture-reader.mjs';

const fixture = JSON.parse(
  await readFile(
    new URL('../packages/poe1/test/fixtures/spark-client.json', import.meta.url),
    'utf8',
  ),
);
function value(result) {
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}
const dataset = value(await loadSparkDataset(fixtureReader(fixture)));
const initial = {
  identity: dataset.identity,
  buildId: 'benchmark-synthetic',
  skill: { id: 'Spark', gemLevel: 20, quality: 0 },
  configuration: { id: 'benchmark-enemy', effectiveLightningResistancePercent: 25 },
  modifiers: Array.from({ length: 32 }, (_, index) => ({
    statId: index % 5 === 0 ? 'base_cast_speed_+%' : 'spell_damage_+%',
    value: 1,
    source: { kind: 'item', id: `synthetic-item-${index}`, line: 1 },
  })),
  addedLightningDamage: [
    {
      statIds: ['spell_minimum_added_lightning_damage', 'spell_maximum_added_lightning_damage'],
      values: [2, 8],
      source: { kind: 'item', id: 'synthetic-added-item', line: 1 },
    },
  ],
};
const size = 1000;
const trials = 5;
const median = (values) =>
  [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];
const reports = [];
for (const mutation of [
  'item-value',
  'enemy-resistance',
  'applicability',
  'added-lightning-range',
]) {
  const states = [];
  const next = structuredClone(initial);
  for (let index = 0; index < size; index++) {
    if (mutation === 'item-value') next.modifiers[1].value = index % 101;
    if (mutation === 'enemy-resistance')
      next.configuration.effectiveLightningResistancePercent = index % 91;
    if (mutation === 'applicability')
      next.modifiers[1].statId = index % 2 === 0 ? 'spell_damage_+%' : 'base_cast_speed_+%';
    if (mutation === 'added-lightning-range')
      next.addedLightningDamage[0].values = [index % 11, 20 + (index % 31)];
    states.push(structuredClone(next));
  }
  const check = value(createSelectedSkillSession(initial, dataset));
  const recalculatedCounts = {};
  for (const state of states) {
    const report = value(check.recalculate(state));
    assert.deepEqual(report.calculation, value(calculateSelectedSkill(state, dataset)));
    for (const node of report.recalculated)
      recalculatedCounts[node] = (recalculatedCounts[node] ?? 0) + 1;
  }
  // Untimed warmup and independent sessions; result equality is checked above, outside timings.
  for (const state of states.slice(0, 100)) value(calculateSelectedSkill(state, dataset));
  const warm = value(createSelectedSkillSession(initial, dataset));
  for (const state of states.slice(0, 100)) value(warm.recalculate(state));
  const fullMs = [];
  const incrementalMs = [];
  let checksum = 0;
  for (let trial = 0; trial < trials; trial++) {
    const session = value(createSelectedSkillSession(initial, dataset));
    const runFull = () => {
      const start = performance.now();
      for (const state of states)
        checksum += value(calculateSelectedSkill(state, dataset)).combinedDps;
      fullMs.push(performance.now() - start);
    };
    const runIncremental = () => {
      const start = performance.now();
      for (const state of states)
        checksum += value(session.recalculate(state)).calculation.combinedDps;
      incrementalMs.push(performance.now() - start);
    };
    if (trial % 2 === 0) {
      runFull();
      runIncremental();
    } else {
      runIncremental();
      runFull();
    }
  }
  const fullMedianMs = median(fullMs);
  const incrementalMedianMs = median(incrementalMs);
  reports.push({
    mutation,
    updates: size,
    trials,
    fullMedianMs,
    incrementalMedianMs,
    incrementalToFullRatio: incrementalMedianMs / fullMedianMs,
    recalculatedCounts,
    finalRecalculated: check.current.recalculated,
    checksum,
  });
}
console.log(
  JSON.stringify(
    {
      benchmark: 'selected-skill-batches-v2',
      engineRevision: selectedSkillEngineRevision,
      node: process.version,
      identity: dataset.identity,
      modifierCount: initial.modifiers.length,
      addedLightningGroupCount: initial.addedLightningDamage.length,
      timing:
        'performance.now; session creation and equality assertions excluded; alternating trial order; median of five warm batches',
      reports,
    },
    null,
    2,
  ),
);
