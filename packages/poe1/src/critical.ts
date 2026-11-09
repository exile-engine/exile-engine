import {
  SELECTED_SPARK_CRITICAL_MODIFIER_STAT_IDS,
  errorDiagnostic,
  failure,
  isSnapshotIdentity,
  sameSnapshot,
  success,
  type CatalogReader,
  type Result,
  type SelectedSkillCriticalDataset,
  type SelectedSkillCriticalTrace,
  type SelectedSkillInput,
  type SelectedSkillSupportTrace,
  type SourceRef,
  type SparkCalculation,
  type SparkDataset,
} from '@exile-engine/core';

const BASE_MULTIPLIER_SOURCE: SourceRef = Object.freeze({
  kind: 'external',
  id: 'pob:3dbca4463c0a59079d9f7f032d8240cf868e09da:src/Data/Misc.lua:89',
  label: 'Pinned PoE1 player critical multiplier rule: 150%; not a client GameConstants record.',
});
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const own = (value: Record<string, unknown>, names: readonly string[]) =>
  names.every((name) => Object.hasOwn(value, name));
const keys = (value: Record<string, unknown>, names: readonly string[]) =>
  Object.keys(value).every((name) => names.includes(name));

export async function loadSelectedSkillCriticalDataset(
  reader: CatalogReader,
): Promise<Result<SelectedSkillCriticalDataset>> {
  if (!isSnapshotIdentity(reader.identity) || reader.identity.game !== 'poe1')
    return failure(errorDiagnostic('critical.snapshot', 'An exact PoE1 snapshot is required.'));
  const identity = { ...reader.identity };
  try {
    const rows = await Promise.all(
      SELECTED_SPARK_CRITICAL_MODIFIER_STAT_IDS.map((id) => reader.getRecord('Stats', id)),
    );
    if (
      rows.some(
        (row, index) =>
          !row ||
          row.key !== SELECTED_SPARK_CRITICAL_MODIFIER_STAT_IDS[index] ||
          row.fields.Id !== row.key ||
          row.fields.IsLocal !== false ||
          row.fields.IsWeaponLocal !== false ||
          !Number.isSafeInteger(row.rowIndex) ||
          row.rowIndex < 0,
      )
    )
      throw new Error('Missing exact global critical modifier stat identities.');
    if (!sameSnapshot(identity, reader.identity))
      throw new Error('Critical snapshot changed while loading.');
    return success({
      identity,
      baseMultiplierPercent: 150,
      baseMultiplierSource: { ...BASE_MULTIPLIER_SOURCE },
      sourceRows: rows.map((row) => ({ table: 'Stats', key: row!.key, rowIndex: row!.rowIndex })),
    });
  } catch (error) {
    return failure(
      errorDiagnostic(
        'critical.invalid-data',
        error instanceof Error ? error.message : 'Invalid critical data.',
      ),
    );
  }
}

export function selectedCriticalDatasetShape(dataset: SparkDataset): boolean {
  const value = dataset.critical;
  if (value === undefined) return true;
  if (
    !Object.hasOwn(dataset, 'critical') ||
    !object(value) ||
    !own(value, ['identity', 'baseMultiplierPercent', 'baseMultiplierSource', 'sourceRows']) ||
    !keys(value, ['identity', 'baseMultiplierPercent', 'baseMultiplierSource', 'sourceRows']) ||
    !object(value.identity) ||
    !own(value.identity, ['game', 'build', 'snapshotId']) ||
    !keys(value.identity, ['game', 'build', 'snapshotId']) ||
    !isSnapshotIdentity(value.identity) ||
    !sameSnapshot(value.identity, dataset.identity) ||
    value.baseMultiplierPercent !== 150 ||
    !object(value.baseMultiplierSource) ||
    !own(value.baseMultiplierSource, ['kind', 'id', 'label']) ||
    !keys(value.baseMultiplierSource, ['kind', 'id', 'label']) ||
    value.baseMultiplierSource.kind !== BASE_MULTIPLIER_SOURCE.kind ||
    value.baseMultiplierSource.id !== BASE_MULTIPLIER_SOURCE.id ||
    value.baseMultiplierSource.label !== BASE_MULTIPLIER_SOURCE.label ||
    !Array.isArray(value.sourceRows) ||
    value.sourceRows.length !== 3
  )
    return false;
  return SELECTED_SPARK_CRITICAL_MODIFIER_STAT_IDS.every(
    (id, index) =>
      Object.hasOwn(value.sourceRows, index) &&
      object(value.sourceRows[index]) &&
      own(value.sourceRows[index], ['table', 'key', 'rowIndex']) &&
      keys(value.sourceRows[index], ['table', 'key', 'rowIndex']) &&
      value.sourceRows[index].table === 'Stats' &&
      value.sourceRows[index].key === id &&
      Number.isSafeInteger(value.sourceRows[index].rowIndex) &&
      value.sourceRows[index].rowIndex >= 0,
  );
}

export interface CriticalModifierTotals {
  readonly increasedChancePercent: number;
  readonly addedMultiplierPercent: number;
}

/** Pure expected-hit calculation. No ailments, lucky rolls, accuracy or critical-only damage effects. */
export function calculateSelectedSkillCriticalEffects(
  input: SelectedSkillInput,
  hit: SparkCalculation,
  supportEffects: SelectedSkillSupportTrace,
  baseChancePercent: number,
  criticalDataset?: SelectedSkillCriticalDataset,
  cachedTotals?: CriticalModifierTotals,
): Result<SelectedSkillCriticalTrace> {
  const mode = input.configuration.criticalStrikeMode ?? 'disabled';
  const modifierContributions = input.modifiers
    .filter((mod) =>
      (SELECTED_SPARK_CRITICAL_MODIFIER_STAT_IDS as readonly string[]).includes(mod.statId),
    )
    .map((mod) => ({
      ...mod,
      source: { ...mod.source },
      ...(mod.conditions === undefined ? {} : { conditions: [...mod.conditions] }),
    }));
  if ((mode === 'average' || modifierContributions.length > 0) && !criticalDataset)
    return failure(
      errorDiagnostic(
        'critical.missing-data',
        'Average critical strikes and critical modifiers require matching normalized critical facts.',
      ),
    );
  const increasedChancePercent =
    cachedTotals?.increasedChancePercent ??
    modifierContributions
      .filter((mod) => mod.statId !== 'base_critical_strike_multiplier_+')
      .reduce((sum, mod) => sum + mod.value, 0);
  const addedMultiplierPercent =
    cachedTotals?.addedMultiplierPercent ??
    modifierContributions
      .filter((mod) => mod.statId === 'base_critical_strike_multiplier_+')
      .reduce((sum, mod) => sum + mod.value, 0);
  const lessChanceMultiplier = supportEffects.criticalChanceMultiplier;
  const unroundedChancePercent =
    baseChancePercent * (1 + increasedChancePercent / 100) * lessChanceMultiplier;
  const roundedChancePercent = Math.floor(unroundedChancePercent * 100 + 0.5) / 100;
  const chancePercent = mode === 'average' ? Math.min(100, Math.max(0, roundedChancePercent)) : 0;
  const baseMultiplierPercent = criticalDataset?.baseMultiplierPercent ?? 150;
  if (!Number.isSafeInteger(baseMultiplierPercent - 100 + addedMultiplierPercent))
    return failure(
      errorDiagnostic(
        'critical.numeric-overflow',
        'Critical multiplier points exceed safe integer limits.',
      ),
    );
  const criticalMultiplier =
    1 +
    Math.max(
      0,
      Math.floor(((baseMultiplierPercent - 100 + addedMultiplierPercent) / 100) * 100 + 0.5) / 100,
    );
  const criticalMin = hit.nonCriticalHitBeforeResistance.min * criticalMultiplier;
  const criticalMax = hit.nonCriticalHitBeforeResistance.max * criticalMultiplier;
  const criticalHitBeforeResistance = {
    min: criticalMin,
    max: criticalMax,
    mean: criticalMin / 2 + criticalMax / 2,
  };
  const resistanceScale = 1 - input.configuration.effectiveLightningResistancePercent / 100;
  const criticalHitAfterResistance = {
    min: criticalHitBeforeResistance.min * resistanceScale,
    max: criticalHitBeforeResistance.max * resistanceScale,
    mean: criticalHitBeforeResistance.mean * resistanceScale,
  };
  const probability = chancePercent / 100;
  const expectedHitMeanBeforeResistance =
    hit.nonCriticalHitBeforeResistance.mean * (1 - probability) +
    criticalHitBeforeResistance.mean * probability;
  const expectedHitMeanAfterResistance =
    hit.nonCriticalHitAfterResistance.mean * (1 - probability) +
    criticalHitAfterResistance.mean * probability;
  if (
    ![
      baseChancePercent,
      increasedChancePercent,
      addedMultiplierPercent,
      lessChanceMultiplier,
      unroundedChancePercent,
      roundedChancePercent,
      chancePercent,
      criticalMultiplier,
      ...Object.values(criticalHitBeforeResistance),
      ...Object.values(criticalHitAfterResistance),
      expectedHitMeanBeforeResistance,
      expectedHitMeanAfterResistance,
    ].every(Number.isFinite)
  )
    return failure(
      errorDiagnostic(
        'critical.numeric-overflow',
        'Critical arithmetic exceeds finite numeric limits.',
      ),
    );
  return success({
    mode,
    baseChancePercent,
    increasedChancePercent,
    lessChanceMultiplier,
    unroundedChancePercent,
    roundedChancePercent,
    chancePercent,
    baseMultiplierPercent,
    addedMultiplierPercent,
    criticalMultiplier,
    criticalHitBeforeResistance,
    criticalHitAfterResistance,
    expectedHitMeanBeforeResistance,
    expectedHitMeanAfterResistance,
    modifierContributions,
    sourceRows: [...hit.sourceRows, ...(criticalDataset?.sourceRows ?? [])].map((row) => ({
      ...row,
    })),
    baseMultiplierSource: { ...(criticalDataset?.baseMultiplierSource ?? BASE_MULTIPLIER_SOURCE) },
  });
}
