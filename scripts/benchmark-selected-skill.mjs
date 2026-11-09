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
  skill: {
    id: 'Spark',
    gemLevel: 20,
    quality: 0,
    supports: [
      {
        id: 'SupportControlledDestruction',
        gemLevel: 1,
        quality: 0,
        enabled: true,
        source: { kind: 'skill', id: 'synthetic-support', line: 1 },
      },
      {
        id: 'SupportFasterCasting',
        gemLevel: 1,
        quality: 0,
        enabled: true,
        source: { kind: 'skill', id: 'synthetic-faster-casting', line: 2 },
      },
    ],
  },
  configuration: {
    id: 'benchmark-enemy',
    lightningResistance: {
      baseResistancePercent: 100,
      maximumResistanceMode: 'configured',
      source: { kind: 'scenario', id: 'synthetic-enemy-resistance', line: 1 },
      exposures: [
        {
          statId: 'lightning_exposure_on_hit_magnitude',
          value: -10,
          enabled: true,
          source: { kind: 'scenario', id: 'synthetic-exposure-1', line: 1 },
        },
        {
          statId: 'lightning_exposure_on_hit_magnitude',
          value: -25,
          enabled: false,
          source: { kind: 'scenario', id: 'synthetic-exposure-2', line: 1 },
        },
      ],
    },
    criticalStrikeMode: 'average',
    ailmentMode: 'configured-shock',
    shock: {
      magnitudePercent: 20,
      uptimePercent: 50,
      source: { kind: 'scenario', id: 'synthetic-shock', line: 1 },
    },
  },
  modifiers: [
    ...Array.from({ length: 32 }, (_, index) => ({
      statId: index % 5 === 0 ? 'base_cast_speed_+%' : 'spell_damage_+%',
      value: 1,
      source: { kind: 'item', id: `synthetic-item-${index}`, line: 1 },
    })),
    {
      statId: 'critical_strike_chance_+%',
      value: 100,
      source: { kind: 'item', id: 'synthetic-critical-global', line: 1 },
    },
    {
      statId: 'spell_critical_strike_chance_+%',
      value: 50,
      source: { kind: 'item', id: 'synthetic-critical-spell', line: 1 },
    },
    {
      statId: 'base_critical_strike_multiplier_+',
      value: 50,
      source: { kind: 'item', id: 'synthetic-critical-multiplier', line: 1 },
    },
    {
      statId: 'base_reduce_enemy_lightning_resistance_%',
      value: 15,
      source: { kind: 'item', id: 'synthetic-lightning-penetration', line: 1 },
    },
  ],
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
  'support-level',
  'support-enabled',
  'critical-chance',
  'critical-multiplier',
  'critical-mode',
  'critical-applicability',
  'exposure-strength',
  'exposure-enabled',
  'lightning-penetration',
  'penetration-applicability',
  'cast-speed-only',
  'shock-magnitude',
  'shock-uptime',
  'shock-mode',
  'faster-casting-level',
  'faster-casting-enabled',
  'support-order',
]) {
  const states = [];
  const next = structuredClone(initial);
  for (let index = 0; index < size; index++) {
    if (mutation === 'item-value') next.modifiers[1].value = index % 101;
    if (mutation === 'enemy-resistance')
      next.configuration.lightningResistance.baseResistancePercent = (index % 151) - 25;
    if (mutation === 'applicability')
      next.modifiers[1].statId = index % 2 === 0 ? 'spell_damage_+%' : 'base_cast_speed_+%';
    if (mutation === 'added-lightning-range')
      next.addedLightningDamage[0].values = [index % 11, 20 + (index % 31)];
    if (mutation === 'support-level') next.skill.supports[0].gemLevel = 1 + (index % 20);
    if (mutation === 'support-enabled') next.skill.supports[0].enabled = index % 2 === 0;
    if (mutation === 'critical-chance') next.modifiers[32].value = index % 501;
    if (mutation === 'critical-multiplier') next.modifiers[34].value = index % 201;
    if (mutation === 'critical-mode')
      next.configuration.criticalStrikeMode = index % 2 === 0 ? 'average' : 'disabled';
    if (mutation === 'critical-applicability')
      next.modifiers[32].statId =
        index % 2 === 0 ? 'critical_strike_chance_+%' : 'base_critical_strike_multiplier_+';
    if (mutation === 'exposure-strength')
      next.configuration.lightningResistance.exposures[0].value = -(index % 51);
    if (mutation === 'exposure-enabled')
      next.configuration.lightningResistance.exposures[1].enabled = index % 2 === 0;
    if (mutation === 'lightning-penetration') next.modifiers[35].value = index % 101;
    if (mutation === 'penetration-applicability')
      next.modifiers[35].statId =
        index % 2 === 0 ? 'base_reduce_enemy_lightning_resistance_%' : 'spell_damage_+%';
    if (mutation === 'cast-speed-only') next.modifiers[0].value = index % 51;
    if (mutation === 'shock-magnitude') next.configuration.shock.magnitudePercent = index % 51;
    if (mutation === 'shock-uptime') next.configuration.shock.uptimePercent = index % 101;
    if (mutation === 'shock-mode') {
      next.configuration.ailmentMode = index % 2 === 0 ? 'configured-shock' : 'excluded';
      if (index % 2 === 0) next.configuration.shock = structuredClone(initial.configuration.shock);
      else delete next.configuration.shock;
    }
    if (mutation === 'faster-casting-level') next.skill.supports[1].gemLevel = 1 + (index % 20);
    if (mutation === 'faster-casting-enabled') next.skill.supports[1].enabled = index % 2 === 0;
    if (mutation === 'support-order')
      next.skill.supports = structuredClone(
        index % 2 === 0 ? initial.skill.supports : [...initial.skill.supports].reverse(),
      );
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
      benchmark: 'selected-skill-batches-v7',
      engineRevision: selectedSkillEngineRevision,
      node: process.version,
      identity: dataset.identity,
      modifierCount: initial.modifiers.length,
      addedLightningGroupCount: initial.addedLightningDamage.length,
      supportCount: initial.skill.supports.length,
      exposureCandidateCount: initial.configuration.lightningResistance.exposures.length,
      timing:
        'performance.now; session creation and equality assertions excluded; alternating trial order; median of five warm batches',
      reports,
    },
    null,
    2,
  ),
);
