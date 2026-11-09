import {
  SELECTED_SPARK_LIGHTNING_PENETRATION_STAT_ID as PENETRATION,
  SELECTED_SPARK_LIGHTNING_EXPOSURE_STAT_ID as EXPOSURE,
  errorDiagnostic,
  failure,
  isSnapshotIdentity,
  sameSnapshot,
  success,
  type CatalogReader,
  type Result,
  type SelectedLightningExposure,
  type SelectedSkillInput,
  type SelectedSkillResistanceDataset,
  type SelectedSkillResistanceTrace,
  type SourceRef,
  type SparkDataset,
} from '@exile-engine/core';

const RULE_SOURCE: SourceRef = Object.freeze({
  kind: 'external',
  id: 'pob:3dbca4463c0a59079d9f7f032d8240cf868e09da:CalcOffence:494-506,3618-3622;CalcPerform:3664-3681;Data:245-259',
  label:
    'Pinned PoE1 resistance profile: strongest exposure, floor -200, configured/default maximum, then penetration without a second floor.',
});
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const own = (value: Record<string, unknown>, names: readonly string[]) =>
  names.every((name) => Object.hasOwn(value, name));
const keys = (value: Record<string, unknown>, names: readonly string[]) =>
  Object.keys(value).every((name) => names.includes(name));

export function validResistanceSource(value: unknown): value is SourceRef {
  return (
    object(value) &&
    own(value, ['kind', 'id']) &&
    keys(value, ['kind', 'id', 'label', 'line']) &&
    value.kind === 'scenario' &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.id.length <= 1024 &&
    (value.label === undefined ||
      (Object.hasOwn(value, 'label') &&
        typeof value.label === 'string' &&
        value.label.length > 0 &&
        value.label.length <= 1024)) &&
    (value.line === undefined ||
      (Object.hasOwn(value, 'line') &&
        Number.isSafeInteger(value.line) &&
        (value.line as number) >= 1))
  );
}

export function validLightningResistanceConfiguration(value: unknown): boolean {
  if (
    !object(value) ||
    !own(value, ['baseResistancePercent', 'maximumResistanceMode', 'source', 'exposures']) ||
    !keys(value, ['baseResistancePercent', 'maximumResistanceMode', 'source', 'exposures']) ||
    !Number.isSafeInteger(value.baseResistancePercent) ||
    (value.baseResistancePercent as number) < -1000 ||
    (value.baseResistancePercent as number) > 1000 ||
    !['configured', 'default75'].includes(value.maximumResistanceMode as string) ||
    !validResistanceSource(value.source) ||
    !Array.isArray(value.exposures) ||
    value.exposures.length > 8
  )
    return false;
  for (let index = 0; index < value.exposures.length; index++) {
    const exposure = value.exposures[index];
    if (
      !Object.hasOwn(value.exposures, index) ||
      !object(exposure) ||
      !own(exposure, ['statId', 'value', 'enabled', 'source']) ||
      !keys(exposure, ['statId', 'value', 'enabled', 'source']) ||
      exposure.statId !== EXPOSURE ||
      !Number.isSafeInteger(exposure.value) ||
      (exposure.value as number) < -100 ||
      (exposure.value as number) > 0 ||
      typeof exposure.enabled !== 'boolean' ||
      !validResistanceSource(exposure.source)
    )
      return false;
  }
  return true;
}

export async function loadSelectedSkillResistanceDataset(
  reader: CatalogReader,
): Promise<Result<SelectedSkillResistanceDataset>> {
  if (!isSnapshotIdentity(reader.identity) || reader.identity.game !== 'poe1')
    return failure(errorDiagnostic('resistance.snapshot', 'An exact PoE1 snapshot is required.'));
  const identity = { ...reader.identity };
  try {
    const rows = await Promise.all(
      [PENETRATION, EXPOSURE].map((id) => reader.getRecord('Stats', id)),
    );
    if (
      rows.some(
        (row, index) =>
          !row ||
          row.key !== [PENETRATION, EXPOSURE][index] ||
          row.fields.Id !== row.key ||
          row.fields.IsLocal !== false ||
          row.fields.IsWeaponLocal !== false ||
          !Number.isSafeInteger(row.rowIndex) ||
          row.rowIndex < 0,
      )
    )
      throw new Error('Missing exact global lightning resistance stat identities.');
    if (!sameSnapshot(identity, reader.identity))
      throw new Error('Resistance snapshot changed while loading.');
    return success({
      identity,
      ruleSource: { ...RULE_SOURCE },
      sourceRows: rows.map((row) => ({ table: 'Stats', key: row!.key, rowIndex: row!.rowIndex })),
    });
  } catch (error) {
    return failure(
      errorDiagnostic(
        'resistance.invalid-data',
        error instanceof Error ? error.message : 'Invalid lightning resistance data.',
      ),
    );
  }
}

export function selectedResistanceDatasetShape(dataset: SparkDataset): boolean {
  const data = dataset.resistance;
  if (data === undefined) return true;
  if (
    !Object.hasOwn(dataset, 'resistance') ||
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
    data.sourceRows.length !== 2
  )
    return false;
  return [PENETRATION, EXPOSURE].every(
    (id, index) =>
      Object.hasOwn(data.sourceRows, index) &&
      object(data.sourceRows[index]) &&
      own(data.sourceRows[index], ['table', 'key', 'rowIndex']) &&
      keys(data.sourceRows[index], ['table', 'key', 'rowIndex']) &&
      data.sourceRows[index].table === 'Stats' &&
      data.sourceRows[index].key === id &&
      Number.isSafeInteger(data.sourceRows[index].rowIndex) &&
      data.sourceRows[index].rowIndex >= 0,
  );
}

export function selectLightningExposure(exposures: readonly SelectedLightningExposure[]): {
  exposurePercent: number;
  selectedExposureIndices: readonly number[];
} {
  let exposurePercent = 0;
  for (const exposure of exposures)
    if (exposure.enabled && exposure.value < exposurePercent) exposurePercent = exposure.value;
  return {
    exposurePercent,
    selectedExposureIndices:
      exposurePercent < 0
        ? exposures.flatMap((exposure, index) =>
            exposure.enabled && exposure.value === exposurePercent ? [index] : [],
          )
        : [],
  };
}

export function capLightningResistance(
  base: number,
  uncapped: number,
  mode: 'configured' | 'default75',
): {
  maximumResistancePercent: number;
  minimumResistancePercent: -200;
  cappedResistancePercent: number;
} {
  const maximumResistancePercent = mode === 'default75' ? 75 : Math.min(Math.max(base, 75), 90);
  return {
    maximumResistancePercent,
    minimumResistancePercent: -200,
    cappedResistancePercent: Math.max(-200, Math.min(uncapped, maximumResistancePercent)),
  };
}

export interface LightningResistanceStages {
  readonly exposurePercent: number;
  readonly selectedExposureIndices: readonly number[];
  readonly uncappedResistancePercent: number;
  readonly maximumResistancePercent: number | null;
  readonly minimumResistancePercent: number | null;
  readonly cappedResistancePercent: number;
  readonly penetrationPercent: number;
  readonly effectiveResistancePercent: number;
}

/** Assemble owned metadata from fully recomputed or cached stages; do not repeat earlier arithmetic. */
export function assembleSelectedSkillResistance(
  input: SelectedSkillInput,
  dataset: SparkDataset,
  stages: LightningResistanceStages,
): Result<SelectedSkillResistanceTrace> {
  const raw = input.configuration.lightningResistance;
  if (raw && !dataset.resistance)
    return failure(
      errorDiagnostic(
        'resistance.missing-data',
        'Configured lightning resistance requires matching normalized resistance facts.',
      ),
    );
  const damageMultiplier = 1 - stages.effectiveResistancePercent / 100;
  if (
    ![
      stages.exposurePercent,
      stages.uncappedResistancePercent,
      stages.cappedResistancePercent,
      stages.penetrationPercent,
      stages.effectiveResistancePercent,
      damageMultiplier,
    ].every(Number.isFinite) ||
    damageMultiplier < 0
  )
    return failure(
      errorDiagnostic(
        'resistance.numeric-overflow',
        'Lightning resistance arithmetic exceeds finite supported limits.',
      ),
    );
  return success({
    profile: raw ? 'configured' : 'effective',
    baseResistancePercent:
      raw?.baseResistancePercent ?? input.configuration.effectiveLightningResistancePercent!,
    maximumResistanceMode: raw?.maximumResistanceMode ?? 'already-effective',
    ...stages,
    selectedExposureIndices: [...stages.selectedExposureIndices],
    damageMultiplier,
    exposureContributions: (raw?.exposures ?? []).map((exposure) => ({
      ...exposure,
      source: { ...exposure.source },
    })),
    penetrationContributions: input.modifiers
      .filter((mod) => mod.statId === PENETRATION)
      .map((mod) => ({
        ...mod,
        source: { ...mod.source },
        ...(mod.conditions === undefined ? {} : { conditions: [...mod.conditions] }),
      })),
    configurationSource: raw
      ? { ...raw.source }
      : {
          kind: 'scenario',
          id: input.configuration.id,
          label:
            'Caller-supplied already-effective lightning resistance; no exposure, cap or penetration inference.',
        },
    ruleSource: { ...(dataset.resistance?.ruleSource ?? RULE_SOURCE) },
    sourceRows: (dataset.resistance?.sourceRows ?? []).map((row) => ({ ...row })),
  });
}

/** Full reference path: select exposure, lower uncapped resistance, cap/floor, then penetrate. */
export function calculateSelectedSkillResistance(
  input: SelectedSkillInput,
  dataset: SparkDataset,
): Result<SelectedSkillResistanceTrace> {
  const raw = input.configuration.lightningResistance;
  if (!raw) {
    const effective = input.configuration.effectiveLightningResistancePercent!;
    return assembleSelectedSkillResistance(input, dataset, {
      exposurePercent: 0,
      selectedExposureIndices: [],
      uncappedResistancePercent: effective,
      maximumResistancePercent: null,
      minimumResistancePercent: null,
      cappedResistancePercent: effective,
      penetrationPercent: 0,
      effectiveResistancePercent: effective,
    });
  }
  const selected = selectLightningExposure(raw.exposures);
  const uncappedResistancePercent = raw.baseResistancePercent + selected.exposurePercent;
  const capped = capLightningResistance(
    raw.baseResistancePercent,
    uncappedResistancePercent,
    raw.maximumResistanceMode,
  );
  const penetrationPercent = input.modifiers
    .filter((mod) => mod.statId === PENETRATION)
    .reduce((sum, mod) => sum + mod.value, 0);
  return assembleSelectedSkillResistance(input, dataset, {
    ...selected,
    uncappedResistancePercent,
    ...capped,
    penetrationPercent,
    effectiveResistancePercent: capped.cappedResistancePercent - penetrationPercent,
  });
}
