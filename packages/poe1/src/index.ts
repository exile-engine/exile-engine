import {
  calculateSparkForGame,
  loadSparkDatasetForGame,
  type CatalogReader,
  type SparkDataset,
  type SparkInput,
} from '@exile-engine/core';

export const game = 'poe1' as const;

/** Load only original-client normal Spark facts, keeping all source row references. */
export function loadSparkDataset(reader: CatalogReader) {
  return loadSparkDatasetForGame(reader, game);
}

/** Evaluate one normal noncritical hit; this function does not calculate full DPS. */
export function calculateSpark(input: SparkInput, dataset: SparkDataset) {
  return calculateSparkForGame(input, dataset, game);
}

export type { SparkInput, SparkDataset, SparkCalculation } from '@exile-engine/core';
export { calculateSelectedSkill, selectedSkillEngineRevision } from './selected-skill.js';
export type {
  SelectedSkillInput,
  SelectedSkillCalculation,
  SelectedSkillConfiguration,
  SelectedSkillSelection,
} from '@exile-engine/core';
export { createSelectedSkillSession } from './incremental.js';
export type { IncrementalSelectedSkillReport, SelectedSkillSession } from './incremental.js';
export { planCalculationGraph } from './graph.js';
export type { CalculationDependencies } from './graph.js';
