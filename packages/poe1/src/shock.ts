import {
  SELECTED_SPARK_SHOCK_STAT_ID,
  errorDiagnostic,
  failure,
  isSnapshotIdentity,
  sameSnapshot,
  success,
  type CatalogReader,
  type Result,
  type SelectedSkillCriticalTrace,
  type SelectedSkillInput,
  type SelectedSkillShockDataset,
  type SelectedSkillShockTrace,
  type SourceRef,
  type SparkCalculation,
  type SparkDataset,
} from '@exile-engine/core';
import { validResistanceSource } from './resistance.js';

const RULE_SOURCE: SourceRef = Object.freeze({
  kind: 'external',
  id: 'pob:3dbca4463c0a59079d9f7f032d8240cf868e09da:ConfigOptions:1943-1949;CalcPerform:3545-3556,3624-3634;CalcOffence:3521-3522,3609-3626;Data:427',
  label:
    'Pinned PoE1 configured shock endpoint: increased damage taken, maximum 50%; host-supplied uptime weights explicit shocked and unshocked states.',
});
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const own = (value: Record<string, unknown>, names: readonly string[]) =>
  names.every((name) => Object.hasOwn(value, name));
const keys = (value: Record<string, unknown>, names: readonly string[]) =>
  Object.keys(value).every((name) => names.includes(name));

export function validShockConfiguration(value: unknown): boolean {
  return (
    object(value) &&
    own(value, ['magnitudePercent', 'uptimePercent', 'source']) &&
    keys(value, ['magnitudePercent', 'uptimePercent', 'source']) &&
    Number.isSafeInteger(value.magnitudePercent) &&
    (value.magnitudePercent as number) >= 0 &&
    (value.magnitudePercent as number) <= 50 &&
    Number.isSafeInteger(value.uptimePercent) &&
    (value.uptimePercent as number) >= 0 &&
    (value.uptimePercent as number) <= 100 &&
    validResistanceSource(value.source)
  );
}

/** The client row identifies shock damage taken; scenario and formula remain separately sourced. */
export async function loadSelectedSkillShockDataset(
  reader: CatalogReader,
): Promise<Result<SelectedSkillShockDataset>> {
  if (!isSnapshotIdentity(reader.identity) || reader.identity.game !== 'poe1')
    return failure(errorDiagnostic('shock.snapshot', 'An exact PoE1 snapshot is required.'));
  const identity = { ...reader.identity };
  try {
    const row = await reader.getRecord('Stats', SELECTED_SPARK_SHOCK_STAT_ID);
    if (
      !row ||
      row.key !== SELECTED_SPARK_SHOCK_STAT_ID ||
      row.fields.Id !== row.key ||
      row.fields.IsLocal !== false ||
      row.fields.IsWeaponLocal !== false ||
      !Number.isSafeInteger(row.rowIndex) ||
      row.rowIndex < 0
    )
      throw new Error('Missing exact global shock damage-taken stat identity.');
    if (!sameSnapshot(identity, reader.identity))
      throw new Error('Shock snapshot changed while loading.');
    return success({
      identity,
      ruleSource: { ...RULE_SOURCE },
      sourceRows: [{ table: 'Stats', key: row.key, rowIndex: row.rowIndex }],
    });
  } catch (error) {
    return failure(
      errorDiagnostic(
        'shock.invalid-data',
        error instanceof Error ? error.message : 'Invalid configured shock data.',
      ),
    );
  }
}

export function selectedShockDatasetShape(dataset: SparkDataset): boolean {
  const data = dataset.shock;
  if (data === undefined) return true;
  if (
    !Object.hasOwn(dataset, 'shock') ||
    !object(data) ||
    !own(data, ['identity', 'ruleSource', 'sourceRows']) ||
    !keys(data, ['identity', 'ruleSource', 'sourceRows']) ||
    !object(data.identity) ||
    !own(data.identity, ['game', 'build', 'snapshotId']) ||
    !keys(data.identity, ['game', 'build', 'snapshotId']) ||
    !isSnapshotIdentity(data.identity) ||
    !sameSnapshot(data.identity, dataset.identity) ||
    !object(data.ruleSource) ||
    !own(data.ruleSource, ['kind', 'id', 'label']) ||
    !keys(data.ruleSource, ['kind', 'id', 'label']) ||
    data.ruleSource.kind !== RULE_SOURCE.kind ||
    data.ruleSource.id !== RULE_SOURCE.id ||
    data.ruleSource.label !== RULE_SOURCE.label ||
    !Array.isArray(data.sourceRows) ||
    data.sourceRows.length !== 1
  )
    return false;
  const row = data.sourceRows[0];
  return (
    Object.hasOwn(data.sourceRows, 0) &&
    object(row) &&
    own(row, ['table', 'key', 'rowIndex']) &&
    keys(row, ['table', 'key', 'rowIndex']) &&
    row.table === 'Stats' &&
    row.key === SELECTED_SPARK_SHOCK_STAT_ID &&
    typeof row.rowIndex === 'number' &&
    Number.isSafeInteger(row.rowIndex) &&
    row.rowIndex >= 0
  );
}

/** Constant casting and unshocked hit distribution in both states; no application inference. */
export function calculateSelectedSkillShockEffects(
  input: SelectedSkillInput,
  hit: SparkCalculation,
  critical: SelectedSkillCriticalTrace,
  dataset?: SelectedSkillShockDataset,
): Result<SelectedSkillShockTrace> {
  const shock = input.configuration.shock;
  if (shock && !dataset)
    return failure(
      errorDiagnostic('shock.missing-data', 'Configured shock requires same-snapshot shock facts.'),
    );
  const magnitudePercent = shock?.magnitudePercent ?? 0;
  const uptimePercent = shock?.uptimePercent ?? 0;
  const shockedDamageMultiplier = 1 + magnitudePercent / 100;
  const averageDamageMultiplier = 1 + (magnitudePercent / 100) * (uptimePercent / 100);
  const unshockedHitMeanAfterResistance = critical.expectedHitMeanAfterResistance;
  const shockedHitMeanAfterResistance = unshockedHitMeanAfterResistance * shockedDamageMultiplier;
  const normalHitMeanAfterShock = hit.nonCriticalHitAfterResistance.mean * averageDamageMultiplier;
  const criticalHitMeanAfterShock =
    critical.criticalHitAfterResistance.mean * averageDamageMultiplier;
  const expectedHitMeanAfterShock = unshockedHitMeanAfterResistance * averageDamageMultiplier;
  if (
    ![
      shockedDamageMultiplier,
      averageDamageMultiplier,
      unshockedHitMeanAfterResistance,
      shockedHitMeanAfterResistance,
      normalHitMeanAfterShock,
      criticalHitMeanAfterShock,
      expectedHitMeanAfterShock,
    ].every(Number.isFinite)
  )
    return failure(
      errorDiagnostic('selected.numeric-overflow', 'Shock arithmetic exceeds finite limits.'),
    );
  return success({
    mode: shock ? 'configured' : 'excluded',
    magnitudePercent,
    uptimePercent,
    shockedDamageMultiplier,
    averageDamageMultiplier,
    unshockedHitMeanAfterResistance,
    shockedHitMeanAfterResistance,
    normalHitMeanAfterShock,
    criticalHitMeanAfterShock,
    expectedHitMeanAfterShock,
    contributions: shock
      ? [
          {
            statId: SELECTED_SPARK_SHOCK_STAT_ID,
            value: magnitudePercent,
            source: { ...shock.source },
            uptimePercent,
            operation: 'increased-damage-taken',
          },
        ]
      : [],
    ruleSource: { ...(dataset?.ruleSource ?? RULE_SOURCE) },
    sourceRows: (dataset?.sourceRows ?? []).map((row) => ({ ...row })),
  });
}
