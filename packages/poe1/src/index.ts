import {
  calculateSparkForGame,
  loadSparkDatasetForGame,
  success,
  failure,
  errorDiagnostic,
  sameSnapshot,
  type CatalogReader,
  type SparkDataset,
  type SparkInput,
} from '@exile-engine/core';
import { loadControlledDestructionDataset } from './supports.js';

export const game = 'poe1' as const;

/** Load only original-client normal Spark facts, keeping all source row references. */
export async function loadSparkDataset(reader: CatalogReader) {
  const loaded = await loadSparkDatasetForGame(reader, game);
  if (!loaded.ok) return loaded;
  const support = await loadControlledDestructionDataset(reader);
  if (!support.ok) return support;
  if (
    !sameSnapshot(loaded.value.identity, support.value.identity) ||
    !sameSnapshot(loaded.value.identity, reader.identity)
  )
    return failure(
      errorDiagnostic(
        'support.snapshot',
        'Spark and support facts must share the exact snapshot throughout loading.',
      ),
    );
  return success<SparkDataset>({ ...loaded.value, supports: [support.value] });
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
  AddedLightningDamageContribution,
  AddedLightningDamageTrace,
  SelectedSkillSupport,
  SelectedSkillSupportTrace,
  SelectedSkillSupportDataset,
} from '@exile-engine/core';
export { createSelectedSkillSession } from './incremental.js';
export type { IncrementalSelectedSkillReport, SelectedSkillSession } from './incremental.js';
export { planCalculationGraph } from './graph.js';
export type { CalculationDependencies } from './graph.js';
