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
import { loadControlledDestructionDataset, loadFasterCastingDataset } from './supports.js';
import { loadSelectedSkillCriticalDataset } from './critical.js';
import { loadSelectedSkillResistanceDataset } from './resistance.js';
import { loadSelectedSkillShockDataset } from './shock.js';
import { loadConductivityDataset } from './conductivity.js';

export const game = 'poe1' as const;

/** Load only original-client normal Spark facts, keeping all source row references. */
export async function loadSparkDataset(reader: CatalogReader) {
  const loaded = await loadSparkDatasetForGame(reader, game);
  if (!loaded.ok) return loaded;
  const support = await loadControlledDestructionDataset(reader);
  if (!support.ok) return support;
  const fasterCasting = await loadFasterCastingDataset(reader);
  if (!fasterCasting.ok) return fasterCasting;
  const critical = await loadSelectedSkillCriticalDataset(reader);
  if (!critical.ok) return critical;
  const resistance = await loadSelectedSkillResistanceDataset(reader);
  if (!resistance.ok) return resistance;
  const shock = await loadSelectedSkillShockDataset(reader);
  if (!shock.ok) return shock;
  const conductivity = await loadConductivityDataset(reader);
  if (!conductivity.ok) return conductivity;
  if (
    !sameSnapshot(loaded.value.identity, support.value.identity) ||
    !sameSnapshot(loaded.value.identity, fasterCasting.value.identity) ||
    !sameSnapshot(loaded.value.identity, reader.identity) ||
    !sameSnapshot(loaded.value.identity, critical.value.identity) ||
    !sameSnapshot(loaded.value.identity, resistance.value.identity) ||
    !sameSnapshot(loaded.value.identity, shock.value.identity) ||
    !sameSnapshot(loaded.value.identity, conductivity.value.identity)
  )
    return failure(
      errorDiagnostic(
        'support.snapshot',
        'Spark and support facts must share the exact snapshot throughout loading.',
      ),
    );
  return success<SparkDataset>({
    ...loaded.value,
    supports: [support.value, fasterCasting.value],
    critical: critical.value,
    resistance: resistance.value,
    shock: shock.value,
    conductivity: conductivity.value,
  });
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
  SelectedSkillControlledDestructionDataset,
  SelectedSkillFasterCastingLevel,
  SelectedSkillFasterCastingDataset,
  SelectedSkillCriticalTrace,
  SelectedSkillCriticalDataset,
  SelectedLightningExposure,
  SelectedLightningResistanceConfiguration,
  SelectedSkillResistanceDataset,
  SelectedSkillResistanceTrace,
  SelectedConductivityConfiguration,
  SelectedConductivityLevel,
  SelectedConductivityDataset,
  SelectedConductivityTrace,
  SelectedShockConfiguration,
  SelectedSkillShockContribution,
  SelectedSkillShockDataset,
  SelectedSkillShockTrace,
} from '@exile-engine/core';
export { createSelectedSkillSession } from './incremental.js';
export type { IncrementalSelectedSkillReport, SelectedSkillSession } from './incremental.js';
export { planCalculationGraph } from './graph.js';
export type { CalculationDependencies } from './graph.js';
