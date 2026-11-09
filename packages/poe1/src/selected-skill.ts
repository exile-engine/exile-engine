import {
  SPARK_MODIFIER_STAT_IDS,
  SPARK_ADDED_LIGHTNING_STAT_IDS,
  calculateSparkForGame,
  errorDiagnostic,
  failure,
  isSnapshotIdentity,
  success,
  type Diagnostic,
  type AddedLightningDamageContribution,
  type AddedLightningDamageTrace,
  type DamageRange,
  type Result,
  type SelectedSkillCalculation,
  type SelectedSkillInput,
  type SparkCalculation,
  type SparkDataset,
  type SparkInput,
  type SelectedSkillSupportTrace,
} from '@exile-engine/core';
import { calculateSelectedSkillSupports, selectedSupportDatasetShape } from './supports.js';
export { calculateSelectedSkillSupports } from './supports.js';

export const selectedSkillEngineRevision = 'poe1-selected-spark-v3' as const;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function ownFields(value: Record<string, unknown>, required: readonly string[]): boolean {
  return required.every((key) => Object.hasOwn(value, key));
}

function id(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function denseArray(value: unknown, maximum: number): value is readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) return false;
  for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) return false;
  return true;
}

/** Reject hidden dataset semantics before capturing or traversing host-owned records. */
function selectedDatasetShape(dataset: SparkDataset): boolean {
  const rows = (value: unknown) =>
    denseArray(value, 10_000) &&
    value.every(
      (row) =>
        object(row) &&
        keys(row, ['table', 'key', 'rowIndex']) &&
        ownFields(row, ['table', 'key', 'rowIndex']),
    );
  return (
    object(dataset) &&
    ownFields(dataset, [
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
      'supports',
    ]) &&
    object(dataset.identity) &&
    keys(dataset.identity, ['game', 'build', 'snapshotId']) &&
    ownFields(dataset.identity, ['game', 'build', 'snapshotId']) &&
    denseArray(dataset.supportedModifierStatIds, SPARK_MODIFIER_STAT_IDS.length) &&
    dataset.supportedModifierStatIds.length === SPARK_MODIFIER_STAT_IDS.length &&
    SPARK_MODIFIER_STAT_IDS.every((statId) => dataset.supportedModifierStatIds.includes(statId)) &&
    denseArray(dataset.levels, 40) &&
    dataset.levels.length === 40 &&
    dataset.levels.every(
      (level) =>
        object(level) &&
        ownFields(level, [
          'gemLevel',
          'baseLightningMin',
          'baseLightningMax',
          'addedDamageEffectiveness',
          'sourceRows',
        ]) &&
        keys(level, [
          'gemLevel',
          'baseLightningMin',
          'baseLightningMax',
          'addedDamageEffectiveness',
          'sourceRows',
        ]) &&
        finite(level.addedDamageEffectiveness) &&
        level.addedDamageEffectiveness >= 0 &&
        rows(level.sourceRows),
    ) &&
    denseArray(dataset.qualityStats, 100) &&
    dataset.qualityStats.every(
      (stat) =>
        object(stat) &&
        ownFields(stat, ['statId', 'valuePerQuality', 'sourceRows']) &&
        keys(stat, ['statId', 'valuePerQuality', 'sourceRows']) &&
        rows(stat.sourceRows),
    ) &&
    rows(dataset.sourceRows) &&
    denseArray(dataset.ruleProvenance, 100) &&
    (dataset.supports === undefined || Object.hasOwn(dataset, 'supports')) &&
    selectedSupportDatasetShape(dataset)
  );
}

/** Input-only boundary shared by fresh and incremental evaluation. No dataset or host I/O. */
export function validateSelectedSkillInput(input: SelectedSkillInput): Result<SelectedSkillInput> {
  const diagnostics: Diagnostic[] = [];
  const reject = (code: string, message: string) =>
    diagnostics.push(errorDiagnostic(code, message));
  if (!object(input))
    return failure(errorDiagnostic('selected.input', 'Expected selected-skill input.'));
  if (!ownFields(input, ['identity', 'buildId', 'skill', 'configuration', 'modifiers']))
    reject(
      'selected.input',
      'Selected-skill identities, configuration and modifiers must be explicit own fields.',
    );
  if (
    !keys(input, [
      'identity',
      'buildId',
      'skill',
      'configuration',
      'modifiers',
      'addedLightningDamage',
    ])
  )
    reject('selected.unsupported-field', 'Unsupported selected-skill input field.');
  if (
    !isSnapshotIdentity(input.identity) ||
    !ownFields(input.identity as unknown as Record<string, unknown>, [
      'game',
      'build',
      'snapshotId',
    ]) ||
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
    !ownFields(skill, ['id', 'gemLevel', 'quality']) ||
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
    (skill.supports !== undefined && (!Array.isArray(skill.supports) || skill.supports.length > 1))
  )
    reject(
      'selected.unsupported-skill',
      'Only normal base Spark, levels 1–40, ordinary quality 0–100 and at most one reviewed support are supported.',
    );
  if (object(skill) && Array.isArray(skill.supports) && skill.supports.length <= 1) {
    for (const support of skill.supports) {
      if (
        !object(support) ||
        !ownFields(support, ['id', 'gemLevel', 'quality', 'enabled', 'source']) ||
        !keys(support, ['id', 'gemLevel', 'quality', 'enabled', 'source']) ||
        support.id !== 'SupportControlledDestruction' ||
        !Number.isSafeInteger(support.gemLevel) ||
        (support.gemLevel as number) < 1 ||
        (support.gemLevel as number) > 20 ||
        support.quality !== 0 ||
        typeof support.enabled !== 'boolean' ||
        !object(support.source) ||
        !ownFields(support.source, ['kind', 'id']) ||
        !keys(support.source, ['kind', 'id', 'label', 'line']) ||
        support.source.kind !== 'skill' ||
        !id(support.source.id) ||
        (support.source.label !== undefined &&
          (!Object.hasOwn(support.source, 'label') || !id(support.source.label))) ||
        (support.source.line !== undefined &&
          (!Object.hasOwn(support.source, 'line') ||
            !finite(support.source.line) ||
            !Number.isSafeInteger(support.source.line) ||
            support.source.line < 1))
      )
        reject(
          'selected.unsupported-support',
          'Only explicit normal Controlled Destruction levels 1–20, quality 0, enabled state and skill provenance are supported.',
        );
    }
  }
  const config = input.configuration;
  if (
    !object(config) ||
    !ownFields(config, ['id', 'effectiveLightningResistancePercent']) ||
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
        !ownFields(mod, ['statId', 'value', 'source']) ||
        !keys(mod, ['statId', 'value', 'source', 'scope', 'conditions']) ||
        !(SPARK_MODIFIER_STAT_IDS as readonly unknown[]).includes(mod.statId) ||
        !finite(mod.value) ||
        (mod.scope !== undefined && mod.scope !== 'global') ||
        (mod.conditions !== undefined &&
          (!Array.isArray(mod.conditions) || mod.conditions.length !== 0)) ||
        !object(mod.source) ||
        !ownFields(mod.source, ['kind', 'id']) ||
        !keys(mod.source, ['kind', 'id', 'label', 'line']) ||
        typeof mod.source.kind !== 'string' ||
        !['item', 'skill', 'quality', 'scenario', 'external'].includes(mod.source.kind) ||
        !id(mod.source.id) ||
        (mod.source.label !== undefined &&
          (!Object.hasOwn(mod.source, 'label') || !id(mod.source.label))) ||
        (mod.source.line !== undefined &&
          (!Object.hasOwn(mod.source, 'line') ||
            !finite(mod.source.line) ||
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
  if (input.addedLightningDamage !== undefined) {
    if (!Array.isArray(input.addedLightningDamage) || input.addedLightningDamage.length > 1000) {
      reject(
        'selected.added-lightning',
        'Added lightning must contain at most 1000 ordered spell damage ranges.',
      );
    } else {
      let minimum = 0;
      let maximum = 0;
      for (const group of input.addedLightningDamage) {
        if (
          !object(group) ||
          !ownFields(group, ['statIds', 'values', 'source']) ||
          !keys(group, ['statIds', 'values', 'source', 'scope', 'conditions']) ||
          !Array.isArray(group.statIds) ||
          group.statIds.length !== 2 ||
          group.statIds[0] !== SPARK_ADDED_LIGHTNING_STAT_IDS[0] ||
          group.statIds[1] !== SPARK_ADDED_LIGHTNING_STAT_IDS[1] ||
          !Array.isArray(group.values) ||
          group.values.length !== 2 ||
          !group.values.every((value) => Number.isSafeInteger(value) && value >= 0) ||
          group.values[0] > group.values[1] ||
          (group.scope !== undefined && group.scope !== 'global') ||
          (group.conditions !== undefined &&
            (!Array.isArray(group.conditions) || group.conditions.length !== 0)) ||
          !object(group.source) ||
          !ownFields(group.source, ['kind', 'id']) ||
          !keys(group.source, ['kind', 'id', 'label', 'line']) ||
          typeof group.source.kind !== 'string' ||
          !['item', 'skill', 'quality', 'scenario', 'external'].includes(group.source.kind) ||
          !id(group.source.id) ||
          (group.source.label !== undefined &&
            (!Object.hasOwn(group.source, 'label') || !id(group.source.label))) ||
          (group.source.line !== undefined &&
            (!Object.hasOwn(group.source, 'line') ||
              !finite(group.source.line) ||
              !Number.isSafeInteger(group.source.line) ||
              group.source.line < 1))
        ) {
          reject(
            'selected.unsupported-added-lightning',
            'Added lightning needs the exact ordered spell minimum/maximum IDs, nonnegative safe integer endpoints in order and provenance; extra, local or conditional semantics are unsupported.',
          );
          continue;
        }
        minimum += group.values[0];
        maximum += group.values[1];
      }
      if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum))
        reject(
          'selected.added-lightning-overflow',
          'Added lightning endpoint sums must remain safe integers.',
        );
    }
  }
  if (diagnostics.length) return { ok: false, diagnostics };
  return success({
    identity: { ...input.identity },
    buildId: input.buildId,
    skill: {
      ...input.skill,
      ...(input.skill.supports === undefined
        ? {}
        : {
            supports: input.skill.supports.map((support) => ({
              ...support,
              source: { ...support.source },
            })),
          }),
    },
    configuration: { ...input.configuration },
    modifiers: input.modifiers.map((mod) => ({
      ...mod,
      source: { ...mod.source },
      ...(mod.conditions === undefined ? {} : { conditions: [...mod.conditions] }),
    })),
    ...(input.addedLightningDamage === undefined
      ? {}
      : { addedLightningDamage: input.addedLightningDamage.map(copyAddedLightning) }),
  });
}

function copyAddedLightning(
  group: AddedLightningDamageContribution,
): AddedLightningDamageContribution {
  return {
    ...group,
    statIds: [...group.statIds],
    values: [...group.values],
    source: { ...group.source },
    ...(group.conditions === undefined ? {} : { conditions: [...group.conditions] }),
  };
}

function range(min: number, max: number): DamageRange {
  return { min, max, mean: (min + max) / 2 };
}

/** Sum ordered raw groups, then apply effectiveness once without intermediate rounding. */
export function calculateAddedLightningDamage(
  input: SelectedSkillInput,
  baseline: SparkCalculation,
  effectiveness: number,
): Result<AddedLightningDamageTrace> {
  const contributions = (input.addedLightningDamage ?? []).map(copyAddedLightning);
  const raw = range(
    contributions.reduce((sum, group) => sum + group.values[0], 0),
    contributions.reduce((sum, group) => sum + group.values[1], 0),
  );
  const effective = range(raw.min * effectiveness, raw.max * effectiveness);
  const combinedBase = range(
    baseline.baseLightningDamage.min + effective.min,
    baseline.baseLightningDamage.max + effective.max,
  );
  if (
    ![
      raw.min,
      raw.max,
      raw.mean,
      effectiveness,
      effective.min,
      effective.max,
      effective.mean,
      combinedBase.min,
      combinedBase.max,
      combinedBase.mean,
    ].every(Number.isFinite)
  )
    return failure(
      errorDiagnostic(
        'selected.numeric-overflow',
        'Added lightning arithmetic exceeds finite numeric limits.',
      ),
    );
  return success({ raw, effectiveness, effective, combinedBase, contributions });
}

function sparkInput(input: SelectedSkillInput): SparkInput {
  return {
    identity: input.identity,
    gemLevel: input.skill.gemLevel,
    quality: input.skill.quality,
    ...(input.skill.variant === undefined ? {} : { variant: input.skill.variant }),
    ...(input.skill.statSet === undefined ? {} : { statSet: input.skill.statSet }),
    modifiers: input.modifiers,
    effectiveLightningResistancePercent: input.configuration.effectiveLightningResistancePercent,
  };
}

/** Shared result construction; a mathematically zero hit is a valid supported result. */
export function assembleSelectedSkill(
  input: SelectedSkillInput,
  hit: SparkCalculation,
  addedLightningDamage: AddedLightningDamageTrace,
  supportEffects: SelectedSkillSupportTrace,
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
      ...(input.skill.supports === undefined
        ? {}
        : {
            supports: input.skill.supports.map((support) => ({
              ...support,
              source: { ...support.source },
            })),
          }),
    },
    engineRevision: selectedSkillEngineRevision,
    metric: 'selected-skill-hit-combined-dps',
    hit,
    addedLightningDamage,
    supportEffects,
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
  const effectiveness = dataset.levels.find(
    (level) => level.gemLevel === validated.value.skill.gemLevel,
  )!.addedDamageEffectiveness!;
  const added = calculateAddedLightningDamage(validated.value, hit.value, effectiveness);
  if (!added.ok) return added;
  const supportEffects = calculateSelectedSkillSupports(validated.value, dataset);
  if (!supportEffects.ok) return supportEffects;
  return assembleSelectedSkill(
    validated.value,
    selectedHitRules(hit.value, added.value.combinedBase, supportEffects.value),
    added.value,
    supportEffects.value,
  );
}

/** Pinned PoB hit rounding and server-tick cast-rate ceiling for this selected slice. */
export function selectedHitRules(
  hit: SparkCalculation,
  combinedBase: DamageRange = hit.baseLightningDamage,
  supportEffects?: SelectedSkillSupportTrace,
): SparkCalculation {
  const damageScale = Math.max(0, 1 + hit.increasedDamagePercent / 100);
  const min = Math.floor(
    combinedBase.min * damageScale * (supportEffects?.spellDamageMultiplier ?? 1) + 0.5,
  );
  const max = Math.floor(
    combinedBase.max * damageScale * (supportEffects?.spellDamageMultiplier ?? 1) + 0.5,
  );
  const scale = 1 - hit.effectiveLightningResistancePercent / 100;
  const speed = Math.floor((1 + hit.increasedCastSpeedPercent / 100) * 100 + 0.5) / 100;
  const castsPerSecond = Math.min(
    speed / (hit.baseCastTimeSeconds * (supportEffects?.castTimeMultiplier ?? 1)),
    1 / 0.033,
  );
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
      'Selected spell added lightning: sum ordered raw minimum/maximum groups, multiply by client added-damage effectiveness, add intrinsic lightning, then apply increases without intermediate rounding.',
      'Controlled Destruction: more spell damage multiplies after increased damage before final rounding; less critical chance is retained but excluded by noncritical mode. Cast-time multiplier is 1; the support record CastTime is not the active skill cast time.',
      'Selected Spark rules: PoB 3dbca4463c0a59079d9f7f032d8240cf868e09da; round hit endpoints before resistance, cast-speed multiplier to two decimals, cast rate at most 1/0.033 per second.',
    ],
  };
}

/** Obtain validated base facts for a new skill/dataset in an incremental session. */
export function prepareSelectedSkill(
  input: SelectedSkillInput,
  dataset: SparkDataset,
): Result<{
  input: SelectedSkillInput;
  baseline: SparkCalculation;
  addedDamageEffectiveness: number;
}> {
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
  return success({
    input: validated.value,
    baseline: baseline.value,
    addedDamageEffectiveness: dataset.levels.find(
      (level) => level.gemLevel === validated.value.skill.gemLevel,
    )!.addedDamageEffectiveness!,
  });
}
