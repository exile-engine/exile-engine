import {
  calculateSparkForGame,
  loadSparkDatasetForGame,
  type CatalogReader,
  type SparkDataset,
  type SparkInput,
} from '@exile-engine/core';

export const game = 'poe2' as const;

/** Load the original-client primary statset, excluding Cold-Infused Spark. */
export function loadSparkDataset(reader: CatalogReader) {
  return loadSparkDatasetForGame(reader, game);
}

/** Evaluate one Base noncritical hit; this function does not calculate full DPS. */
export function calculateSpark(input: SparkInput, dataset: SparkDataset) {
  return calculateSparkForGame(input, dataset, game);
}

export type { SparkInput, SparkDataset, SparkCalculation } from '@exile-engine/core';
