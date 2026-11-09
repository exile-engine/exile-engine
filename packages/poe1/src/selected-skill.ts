import {
  SPARK_MODIFIER_STAT_IDS,
  calculateSparkForGame,
  errorDiagnostic,
  failure,
  isSnapshotIdentity,
  success,
  type Diagnostic,
  type Result,
  type SelectedSkillCalculation,
  type SelectedSkillInput,
  type SparkCalculation,
  type SparkDataset,
  type SparkInput,
} from '@exile-engine/core';

export const selectedSkillEngineRevision = 'poe1-selected-spark-v1' as const;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function id(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Reject hidden dataset semantics before capturing or traversing host-owned records. */
function selectedDatasetShape(dataset: SparkDataset): boolean {
  const rows = (value: unknown) =>
    Array.isArray(value) &&
    value.length <= 10_000 &&
    value.every((row) => object(row) && keys(row, ['table', 'key', 'rowIndex']));
  return (
    object(dataset) &&
    keys(dataset, [
      'identity',
      'baseDamageAuthority',
      'grantedEffectId',
      'statSetId',
      'baseCastTimeSeconds',
      'supportedModifierStatIds',
      'levels',
      'qualityStats',
      'sourceRows',
      'ruleProvenance',
    ]) &&
    object(dataset.identity) &&
    keys(dataset.identity, ['game', 'build', 'snapshotId']) &&
    Array.isArray(dataset.supportedModifierStatIds) &&
    dataset.supportedModifierStatIds.length === SPARK_MODIFIER_STAT_IDS.length &&
    SPARK_MODIFIER_STAT_IDS.every((statId) => dataset.supportedModifierStatIds.includes(statId)) &&
    Array.isArray(dataset.levels) &&
    dataset.levels.length === 40 &&
    dataset.levels.every(
      (level) =>
        object(level) &&
        keys(level, ['gemLevel', 'baseLightningMin', 'baseLightningMax', 'sourceRows']) &&
        rows(level.sourceRows),
    ) &&
    Array.isArray(dataset.qualityStats) &&
    dataset.qualityStats.length <= 100 &&
    dataset.qualityStats.every(
      (stat) =>
        object(stat) &&
        keys(stat, ['statId', 'valuePerQuality', 'sourceRows']) &&
        rows(stat.sourceRows),
    ) &&
    rows(dataset.sourceRows)
  );
}

/** Input-only boundary shared by fresh and incremental evaluation. No dataset or host I/O. */
export function validateSelectedSkillInput(input: SelectedSkillInput): Result<SelectedSkillInput> {
  const diagnostics: Diagnostic[] = [];
  const reject = (code: string, message: string) =>
    diagnostics.push(errorDiagnostic(code, message));
  if (!object(input))
    return failure(errorDiagnostic('selected.input', 'Expected selected-skill input.'));
  if (!keys(input, ['identity', 'buildId', 'skill', 'configuration', 'modifiers']))
    reject('selected.unsupported-field', 'Unsupported selected-skill input field.');
  if (
    !isSnapshotIdentity(input.identity) ||
    input.identity.game !== 'poe1' ||
    !keys(input.identity as unknown as Record<string, unknown>, ['game', 'build', 'snapshotId']) ||
    !id(input.identity.build) ||
    !id(input.identity.snapshotId) ||
    !id(input.buildId)
  )
    reject('selected.identity', 'An explicit PoE1 game/build/snapshot and build ID are required.');
  const skill = input.skill;
  if (
    !object(skill) ||
    !keys(skill, ['id', 'gemLevel', 'quality', 'variant', 'statSet', 'supports']) ||
    skill.id !== 'Spark' ||
    !Number.isSafeInteger(skill.gemLevel) ||
    skill.gemLevel < 1 ||
    skill.gemLevel > 40 ||
    !Number.isSafeInteger(skill.quality) ||
    skill.quality < 0 ||
    skill.quality > 100 ||
    (skill.variant !== undefined && skill.variant !== 'normal') ||
    (skill.statSet !== undefined && skill.statSet !== 'base') ||
    (skill.supports !== undefined &&
      (!Array.isArray(skill.supports) || skill.supports.length !== 0))
  )
    reject(
      'selected.unsupported-skill',
      'Only normal base Spark, levels 1–40, ordinary quality 0–100 and no supports are supported.',
    );
  const config = input.configuration;
  if (
    !object(config) ||
    !keys(config, ['id', 'effectiveLightningResistancePercent']) ||
    !id(config.id) ||
    !finite(config.effectiveLightningResistancePercent) ||
    config.effectiveLightningResistancePercent < -200 ||
    config.effectiveLightningResistancePercent > 90
  )
    reject(
      'selected.configuration',
      'An explicit configuration ID and effective lightning resistance from -200% through 90% are required.',
    );
  if (!Array.isArray(input.modifiers) || input.modifiers.length > 1000) {
    reject('selected.modifiers', 'Expected at most 1000 individual contributions.');
  } else {
    for (const mod of input.modifiers) {
      if (
        !object(mod) ||
        !keys(mod, ['statId', 'value', 'source', 'scope', 'conditions']) ||
        !(SPARK_MODIFIER_STAT_IDS as readonly unknown[]).includes(mod.statId) ||
        !finite(mod.value) ||
        (mod.scope !== undefined && mod.scope !== 'global') ||
        (mod.conditions !== undefined &&
          (!Array.isArray(mod.conditions) || mod.conditions.length !== 0)) ||
        !object(mod.source) ||
        !keys(mod.source, ['kind', 'id', 'label', 'line']) ||
        typeof mod.source.kind !== 'string' ||
        !['item', 'skill', 'quality', 'scenario', 'external'].includes(mod.source.kind) ||
        !id(mod.source.id) ||
        (mod.source.label !== undefined && !id(mod.source.label)) ||
        (mod.source.line !== undefined &&
          (!finite(mod.source.line) ||
            !Number.isSafeInteger(mod.source.line) ||
            mod.source.line < 1))
      )
        reject(
          'selected.unsupported-modifier',
          'Each contribution needs a supported exact stat ID, finite value and source; local, conditional and extra semantics are unsupported.',
        );
    }
    if (diagnostics.length === 0) {
      const damage = input.modifiers
        .filter((mod) => mod.statId !== 'base_cast_speed_+%')
        .reduce((sum, mod) => sum + mod.value, 0);
      const speed = input.modifiers
        .filter((mod) => mod.statId === 'base_cast_speed_+%')
        .reduce((sum, mod) => sum + mod.value, 0);
      if (
        !Number.isFinite(damage) ||
        damage < -100 ||
        !Number.isFinite(speed) ||
        Math.floor((1 + speed / 100) * 100 + 0.5) / 100 <= 0
      )
        reject(
          'selected.multiplier',
          'Finite additive totals, damage increase at least -100% and a positive rounded cast-speed multiplier are required.',
        );
    }
  }
  if (diagnostics.length) return { ok: false, diagnostics };
  return success({
    identity: { ...input.identity },
    buildId: input.buildId,
    skill: {
      ...input.skill,
      ...(input.skill.supports === undefined ? {} : { supports: [...input.skill.supports] }),
    },
    configuration: { ...input.configuration },
    modifiers: input.modifiers.map((mod) => ({
      ...mod,
      source: { ...mod.source },
      ...(mod.conditions === undefined ? {} : { conditions: [...mod.conditions] }),
    })),
  });
}

function sparkInput(input: SelectedSkillInput): SparkInput {
  return {
    identity: input.identity,
    gemLevel: input.skill.gemLevel,
    quality: input.skill.quality,
    ...(input.skill.variant === undefined ? {} : { variant: input.skill.variant }),
    ...(input.skill.statSet === undefined ? {} : { statSet: input.skill.statSet }),
    ...(input.skill.supports === undefined ? {} : { supports: input.skill.supports }),
    modifiers: input.modifiers,
    effectiveLightningResistancePercent: input.configuration.effectiveLightningResistancePercent,
  };
}

/** Shared result construction; a mathematically zero hit is a valid supported result. */
export function assembleSelectedSkill(
  input: SelectedSkillInput,
  hit: SparkCalculation,
): Result<SelectedSkillCalculation> {
  const hitDps = hit.nonCriticalHitAfterResistance.mean * hit.castsPerSecond;
  if (!Number.isFinite(hitDps) || !Number.isFinite(hit.castsPerSecond) || hit.castsPerSecond <= 0)
    return failure(
      errorDiagnostic(
        'selected.numeric-overflow',
        'Selected-skill DPS exceeds finite numeric limits.',
      ),
    );
  return success({
    identity: { ...input.identity },
    buildId: input.buildId,
    configuration: { ...input.configuration },
    skill: {
      ...input.skill,
      ...(input.skill.supports === undefined ? {} : { supports: [...input.skill.supports] }),
    },
    engineRevision: selectedSkillEngineRevision,
    metric: 'selected-skill-hit-combined-dps',
    hit,
    hitsPerCast: 1,
    hitsPerSecond: hit.castsPerSecond,
    hitDps,
    combinedDps: hitDps,
    includedDamage: ['lightning-hit'],
  });
}

/** Clean reference path: validate and recompute every supported rule from scratch. */
export function calculateSelectedSkill(
  input: SelectedSkillInput,
  dataset: SparkDataset,
): Result<SelectedSkillCalculation> {
  const validated = validateSelectedSkillInput(input);
  if (!validated.ok) return validated;
  if (!selectedDatasetShape(dataset))
    return failure(
      errorDiagnostic(
        'selected.dataset-shape',
        'The selected slice requires an exact bounded Spark dataset schema with all five supported modifier IDs.',
      ),
    );
  const hit = calculateSparkForGame(sparkInput(validated.value), dataset, 'poe1');
  if (!hit.ok) return hit;
  return assembleSelectedSkill(validated.value, selectedHitRules(hit.value));
}

/** Pinned PoB hit rounding and server-tick cast-rate ceiling for this selected slice. */
export function selectedHitRules(hit: SparkCalculation): SparkCalculation {
  const min = Math.floor(hit.nonCriticalHitBeforeResistance.min + 0.5);
  const max = Math.floor(hit.nonCriticalHitBeforeResistance.max + 0.5);
  const scale = 1 - hit.effectiveLightningResistancePercent / 100;
  const speed = Math.floor((1 + hit.increasedCastSpeedPercent / 100) * 100 + 0.5) / 100;
  const castsPerSecond = Math.min(speed / hit.baseCastTimeSeconds, 1 / 0.033);
  return {
    ...hit,
    nonCriticalHitBeforeResistance: { min, max, mean: (min + max) / 2 },
    nonCriticalHitAfterResistance: {
      min: min * scale,
      max: max * scale,
      mean: ((min + max) / 2) * scale,
    },
    castsPerSecond,
    castTimeSeconds: 1 / castsPerSecond,
    ruleProvenance: [
      ...hit.ruleProvenance,
      'Selected Spark rules: PoB 3dbca4463c0a59079d9f7f032d8240cf868e09da; round hit endpoints before resistance, cast-speed multiplier to two decimals, cast rate at most 1/0.033 per second.',
    ],
  };
}

/** Obtain validated base facts for a new skill/dataset in an incremental session. */
export function prepareSelectedSkill(
  input: SelectedSkillInput,
  dataset: SparkDataset,
): Result<{ input: SelectedSkillInput; baseline: SparkCalculation }> {
  const validated = validateSelectedSkillInput(input);
  if (!validated.ok) return validated;
  if (!selectedDatasetShape(dataset))
    return failure(
      errorDiagnostic(
        'selected.dataset-shape',
        'The selected slice requires an exact bounded Spark dataset schema with all five supported modifier IDs.',
      ),
    );
  const baseline = calculateSparkForGame(
    { ...sparkInput(validated.value), modifiers: [], effectiveLightningResistancePercent: 0 },
    dataset,
    'poe1',
  );
  if (!baseline.ok) return baseline;
  return success({ input: validated.value, baseline: baseline.value });
}
