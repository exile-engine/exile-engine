import {
  SPARK_MODIFIER_STAT_IDS,
  errorDiagnostic,
  failure,
  sameSnapshot,
  success,
  type DamageRange,
  type Result,
  type SelectedSkillCalculation,
  type SelectedSkillInput,
  type SparkCalculation,
  type SparkDataset,
  type StatContribution,
} from '@exile-engine/core';
import {
  assembleSelectedSkill,
  calculateSelectedSkill,
  calculateSelectedSkillSupports,
  calculateSelectedSkillCriticalEffects,
  prepareSelectedSkill,
  selectedHitRules,
  validateSelectedSkillInput,
} from './selected-skill.js';
import { planCalculationGraph, type CalculationDependencies } from './graph.js';
import {
  assembleSelectedSkillResistance,
  capLightningResistance,
  selectLightningExposure,
  type LightningResistanceStages,
} from './resistance.js';
import { calculateSelectedSkillShockEffects } from './shock.js';

export interface IncrementalSelectedSkillReport {
  readonly calculation: SelectedSkillCalculation;
  /** Derived nodes actually evaluated, in dependency order; input comparisons are excluded. */
  readonly recalculated: readonly string[];
  readonly dependencies: CalculationDependencies;
}

export interface SelectedSkillSession {
  readonly current: IncrementalSelectedSkillReport;
  /** Invalid updates are atomic: the last accepted state and caches are retained. */
  recalculate(input: SelectedSkillInput): Result<IncrementalSelectedSkillReport>;
}

const CAST_SPEED = 'base_cast_speed_+%';
const CRITICAL_MULTIPLIER = 'base_critical_strike_multiplier_+';
const LIGHTNING_PENETRATION = 'base_reduce_enemy_lightning_resistance_%';
const DAMAGE_STATS = new Set<string>(SPARK_MODIFIER_STAT_IDS.filter((id) => id !== CAST_SPEED));
const CRITICAL_CHANCE_STATS = new Set([
  'critical_strike_chance_+%',
  'spell_critical_strike_chance_+%',
]);
const DERIVED = new Set([
  'base',
  'added-lightning',
  'effective-added-lightning',
  'combined-base',
  'damage-increase',
  'cast-speed-increase',
  'support-effects',
  'critical-chance-increase',
  'critical-multiplier-increase',
  'lightning-exposure',
  'lightning-penetration',
  'uncapped-resistance',
  'capped-resistance',
  'effective-resistance',
  'resistance-effects',
  'damage-before-resistance',
  'damage-after-resistance',
  'cast-rate',
  'critical-effects',
  'shock-effects',
  'selected-skill',
]);

function copyModifier(modifier: StatContribution): StatContribution {
  return {
    ...modifier,
    source: { ...modifier.source },
    ...(modifier.conditions ? { conditions: [...modifier.conditions] } : {}),
  };
}

function copyInput(input: SelectedSkillInput): SelectedSkillInput {
  return {
    ...input,
    identity: { ...input.identity },
    skill: {
      ...input.skill,
      ...(input.skill.supports
        ? {
            supports: input.skill.supports.map((support) => ({
              ...support,
              source: { ...support.source },
            })),
          }
        : {}),
    },
    configuration: {
      ...input.configuration,
      ...(input.configuration.shock === undefined
        ? {}
        : {
            shock: {
              ...input.configuration.shock,
              source: { ...input.configuration.shock.source },
            },
          }),
      ...(input.configuration.lightningResistance === undefined
        ? {}
        : {
            lightningResistance: {
              ...input.configuration.lightningResistance,
              source: { ...input.configuration.lightningResistance.source },
              exposures: input.configuration.lightningResistance.exposures.map((exposure) => ({
                ...exposure,
                source: { ...exposure.source },
              })),
            },
          }),
    },
    modifiers: input.modifiers.map(copyModifier),
    ...(input.addedLightningDamage === undefined
      ? {}
      : {
          addedLightningDamage: input.addedLightningDamage.map((group) => ({
            ...group,
            statIds: [group.statIds[0], group.statIds[1]],
            values: [group.values[0], group.values[1]],
            source: { ...group.source },
            ...(group.conditions ? { conditions: [...group.conditions] } : {}),
          })),
        }),
  };
}

function copyDataset(dataset: SparkDataset): SparkDataset {
  const copyRows = (rows: SparkDataset['sourceRows']) =>
    rows.map((row) => ({
      table: row.table,
      key: row.key,
      rowIndex: row.rowIndex,
    }));
  return {
    identity: {
      game: dataset.identity.game,
      build: dataset.identity.build,
      snapshotId: dataset.identity.snapshotId,
    },
    baseDamageAuthority: dataset.baseDamageAuthority,
    grantedEffectId: dataset.grantedEffectId,
    statSetId: dataset.statSetId,
    baseCastTimeSeconds: dataset.baseCastTimeSeconds,
    supportedModifierStatIds: [...dataset.supportedModifierStatIds],
    levels: dataset.levels.map((level) => ({
      gemLevel: level.gemLevel,
      baseLightningMin: level.baseLightningMin,
      baseLightningMax: level.baseLightningMax,
      ...(level.addedDamageEffectiveness === undefined
        ? {}
        : { addedDamageEffectiveness: level.addedDamageEffectiveness }),
      ...(level.baseCriticalStrikeChancePercent === undefined
        ? {}
        : {
            baseCriticalStrikeChancePercent: level.baseCriticalStrikeChancePercent,
          }),
      sourceRows: copyRows(level.sourceRows),
    })),
    qualityStats: dataset.qualityStats.map((stat) => ({
      statId: stat.statId,
      valuePerQuality: stat.valuePerQuality,
      sourceRows: copyRows(stat.sourceRows),
    })),
    sourceRows: copyRows(dataset.sourceRows),
    ruleProvenance: [...dataset.ruleProvenance],
    ...(dataset.supports === undefined
      ? {}
      : {
          supports: dataset.supports.map((support) => {
            const common = {
              identity: {
                game: support.identity.game,
                build: support.identity.build,
                snapshotId: support.identity.snapshotId,
              },
              gemId: support.gemId,
              sourceRows: copyRows(support.sourceRows),
            };
            return support.id === 'SupportControlledDestruction'
              ? {
                  ...common,
                  id: support.id,
                  levels: support.levels.map((level) => ({
                    gemLevel: level.gemLevel,
                    moreSpellDamagePercent: level.moreSpellDamagePercent,
                    criticalStrikeChancePercent: level.criticalStrikeChancePercent,
                    manaCostMultiplier: level.manaCostMultiplier,
                    sourceRows: copyRows(level.sourceRows),
                  })),
                }
              : {
                  ...common,
                  id: support.id,
                  levels: support.levels.map((level) => ({
                    gemLevel: level.gemLevel,
                    increasedCastSpeedPercent: level.increasedCastSpeedPercent,
                    manaCostMultiplier: level.manaCostMultiplier,
                    sourceRows: copyRows(level.sourceRows),
                  })),
                };
          }),
        }),
    ...(dataset.critical === undefined
      ? {}
      : {
          critical: {
            identity: {
              game: dataset.critical.identity.game,
              build: dataset.critical.identity.build,
              snapshotId: dataset.critical.identity.snapshotId,
            },
            baseMultiplierPercent: dataset.critical.baseMultiplierPercent,
            baseMultiplierSource: { ...dataset.critical.baseMultiplierSource },
            sourceRows: copyRows(dataset.critical.sourceRows),
          },
        }),
    ...(dataset.resistance === undefined
      ? {}
      : {
          resistance: {
            identity: {
              game: dataset.resistance.identity.game,
              build: dataset.resistance.identity.build,
              snapshotId: dataset.resistance.identity.snapshotId,
            },
            ruleSource: { ...dataset.resistance.ruleSource },
            sourceRows: copyRows(dataset.resistance.sourceRows),
          },
        }),
    ...(dataset.shock === undefined
      ? {}
      : {
          shock: {
            identity: {
              game: dataset.shock.identity.game,
              build: dataset.shock.identity.build,
              snapshotId: dataset.shock.identity.snapshotId,
            },
            ruleSource: { ...dataset.shock.ruleSource },
            sourceRows: copyRows(dataset.shock.sourceRows),
          },
        }),
  };
}

function copyShockEffects(
  effects: SelectedSkillCalculation['shockEffects'],
): SelectedSkillCalculation['shockEffects'] {
  return {
    ...effects,
    contributions: effects.contributions.map((contribution) => ({
      ...contribution,
      source: { ...contribution.source },
    })),
    ruleSource: { ...effects.ruleSource },
    sourceRows: effects.sourceRows.map((row) => ({
      table: row.table,
      key: row.key,
      rowIndex: row.rowIndex,
    })),
  };
}

function copyResistanceEffects(
  effects: SelectedSkillCalculation['resistanceEffects'],
): SelectedSkillCalculation['resistanceEffects'] {
  return {
    ...effects,
    exposureContributions: effects.exposureContributions.map((exposure) => ({
      ...exposure,
      source: { ...exposure.source },
    })),
    selectedExposureIndices: [...effects.selectedExposureIndices],
    penetrationContributions: effects.penetrationContributions.map(copyModifier),
    configurationSource: { ...effects.configurationSource },
    ruleSource: { ...effects.ruleSource },
    sourceRows: effects.sourceRows.map((row) => ({
      table: row.table,
      key: row.key,
      rowIndex: row.rowIndex,
    })),
  };
}

function copyCriticalEffects(
  effects: SelectedSkillCalculation['criticalEffects'],
): SelectedSkillCalculation['criticalEffects'] {
  return {
    ...effects,
    criticalHitBeforeResistance: { ...effects.criticalHitBeforeResistance },
    criticalHitAfterResistance: { ...effects.criticalHitAfterResistance },
    modifierContributions: effects.modifierContributions.map(copyModifier),
    sourceRows: effects.sourceRows.map((row) => ({
      table: row.table,
      key: row.key,
      rowIndex: row.rowIndex,
    })),
    baseMultiplierSource: { ...effects.baseMultiplierSource },
  };
}

function copySupportEffects(
  effects: SelectedSkillCalculation['supportEffects'],
): SelectedSkillCalculation['supportEffects'] {
  const copyRows = (rows: SparkDataset['sourceRows']) =>
    rows.map((row) => ({
      table: row.table,
      key: row.key,
      rowIndex: row.rowIndex,
    }));
  return {
    ...effects,
    supports: effects.supports.map((support) => ({ ...support, source: { ...support.source } })),
    contributions: effects.contributions.map((contribution) => ({
      ...contribution,
      source: { ...contribution.source },
      ...(contribution.conditions ? { conditions: [...contribution.conditions] } : {}),
      sourceRows: copyRows(contribution.sourceRows),
    })),
    sourceRows: copyRows(effects.sourceRows),
  };
}

/** All objects passed here were constructed from validated bounded records. */
function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

function inputNodes(input: SelectedSkillInput): Readonly<Record<string, unknown>> {
  const baseSkill = Object.fromEntries(
    Object.entries(input.skill).filter(([key]) => key !== 'supports'),
  );
  const resistance = input.configuration.lightningResistance;
  return Object.fromEntries([
    ['input.metadata', [input.identity, input.buildId, input.configuration.id]],
    ['input.skill', baseSkill],
    ['input.supports', [Object.hasOwn(input.skill, 'supports'), input.skill.supports]],
    [
      'input.critical-configuration',
      [
        Object.hasOwn(input.configuration, 'criticalStrikeMode'),
        input.configuration.criticalStrikeMode,
      ],
    ],
    [
      'input.shock',
      [
        Object.hasOwn(input.configuration, 'ailmentMode'),
        input.configuration.ailmentMode,
        Object.hasOwn(input.configuration, 'shock'),
        input.configuration.shock,
      ],
    ],
    [
      'input.resistance',
      [
        Object.hasOwn(input.configuration, 'effectiveLightningResistancePercent'),
        input.configuration.effectiveLightningResistancePercent,
        Object.hasOwn(input.configuration, 'lightningResistance'),
        resistance === undefined ? 'effective' : 'configured',
        resistance?.baseResistancePercent,
      ],
    ],
    ['input.resistance-maximum', resistance?.maximumResistanceMode ?? 'already-effective'],
    [
      'input.resistance-source',
      resistance?.source ?? { kind: 'scenario', id: input.configuration.id },
    ],
    ...(resistance?.exposures ?? []).map((exposure, index) => [`exposure:${index}`, exposure]),
    ...input.modifiers.map((modifier, index) => [`modifier:${index}`, modifier]),
    ...(input.addedLightningDamage ?? []).map((group, index) => [
      `added-lightning:${index}`,
      group,
    ]),
  ]);
}

function graph(input: SelectedSkillInput): CalculationDependencies {
  const roots = inputNodes(input);
  const damage: string[] = [];
  const speed: string[] = [];
  const criticalChance: string[] = [];
  const criticalMultiplier: string[] = [];
  const penetration: string[] = [];
  input.modifiers.forEach((modifier, index) => {
    if (modifier.statId === CAST_SPEED) speed.push(`modifier:${index}`);
    else if (DAMAGE_STATS.has(modifier.statId)) damage.push(`modifier:${index}`);
    else if (CRITICAL_CHANCE_STATS.has(modifier.statId)) criticalChance.push(`modifier:${index}`);
    else if (modifier.statId === CRITICAL_MULTIPLIER) criticalMultiplier.push(`modifier:${index}`);
    else if (modifier.statId === LIGHTNING_PENETRATION) penetration.push(`modifier:${index}`);
  });
  return {
    ...Object.fromEntries(Object.keys(roots).map((id) => [id, []])),
    base: ['input.skill'],
    'added-lightning': (input.addedLightningDamage ?? []).map(
      (_, index) => `added-lightning:${index}`,
    ),
    'effective-added-lightning': ['base', 'added-lightning'],
    'combined-base': ['base', 'effective-added-lightning'],
    'damage-increase': damage,
    'cast-speed-increase': speed,
    'support-effects': ['input.supports'],
    'critical-chance-increase': criticalChance,
    'critical-multiplier-increase': criticalMultiplier,
    'lightning-exposure': (input.configuration.lightningResistance?.exposures ?? []).map(
      (_, index) => `exposure:${index}`,
    ),
    'lightning-penetration': penetration,
    'uncapped-resistance': ['input.resistance', 'lightning-exposure'],
    'capped-resistance': ['input.resistance', 'input.resistance-maximum', 'uncapped-resistance'],
    'effective-resistance': ['capped-resistance', 'lightning-penetration'],
    'resistance-effects': [
      'input.resistance',
      'input.resistance-maximum',
      'input.resistance-source',
      'lightning-exposure',
      'lightning-penetration',
      'uncapped-resistance',
      'capped-resistance',
      'effective-resistance',
    ],
    'damage-before-resistance': ['combined-base', 'damage-increase', 'support-effects'],
    'damage-after-resistance': ['damage-before-resistance', 'effective-resistance'],
    'cast-rate': ['base', 'cast-speed-increase', 'support-effects'],
    'critical-effects': [
      'base',
      'support-effects',
      'critical-chance-increase',
      'critical-multiplier-increase',
      'damage-after-resistance',
      'input.critical-configuration',
      'effective-resistance',
    ],
    'shock-effects': ['input.shock', 'damage-after-resistance', 'critical-effects'],
    'selected-skill': [
      'input.metadata',
      'input.skill',
      'input.supports',
      'input.critical-configuration',
      'input.shock',
      'input.resistance',
      'input.resistance-maximum',
      'input.resistance-source',
      ...input.modifiers.map((_, index) => `modifier:${index}`),
      ...(input.addedLightningDamage ?? []).map((_, index) => `added-lightning:${index}`),
      'base',
      'added-lightning',
      'effective-added-lightning',
      'combined-base',
      'damage-increase',
      'cast-speed-increase',
      'support-effects',
      'critical-chance-increase',
      'critical-multiplier-increase',
      'resistance-effects',
      'damage-before-resistance',
      'damage-after-resistance',
      'cast-rate',
      'critical-effects',
      'shock-effects',
    ],
  };
}

function equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        equal((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
    )
  );
}

function range(min: number, max: number): DamageRange {
  return { min, max, mean: (min + max) / 2 };
}

interface Cache {
  readonly baseline: SparkCalculation;
  readonly rawAdded: DamageRange;
  readonly effectiveness: number;
  readonly effectiveAdded: DamageRange;
  readonly combinedBase: DamageRange;
  readonly damageIncrease: number;
  readonly speedIncrease: number;
  readonly supportEffects: SelectedSkillCalculation['supportEffects'];
  readonly baseChancePercent: number;
  readonly increasedChancePercent: number;
  readonly addedMultiplierPercent: number;
  readonly criticalEffects: SelectedSkillCalculation['criticalEffects'];
  readonly resistanceEffects: SelectedSkillCalculation['resistanceEffects'];
  readonly resistanceStages: LightningResistanceStages;
  readonly shockEffects: SelectedSkillCalculation['shockEffects'];
  readonly before: DamageRange;
  readonly after: DamageRange;
  readonly castTime: number;
  readonly casts: number;
}

/**
 * Capture an immutable dataset once; compare bounded input leaves on each update.
 * Formula nodes are reused unless a read or the set of reads changes.
 */
export function createSelectedSkillSession(
  input: SelectedSkillInput,
  dataset: SparkDataset,
): Result<SelectedSkillSession> {
  const full = calculateSelectedSkill(input, dataset);
  if (!full.ok) return full;
  const captured = immutable(copyDataset(dataset));
  let accepted = immutable(copyInput(input));
  const prepared = prepareSelectedSkill(accepted, captured);
  if (!prepared.ok) return prepared;
  let dependencies = immutable(graph(accepted));
  const plan = planCalculationGraph(dependencies);
  if (!plan.ok) return plan;
  const hit = full.value.hit;
  let cache: Cache = {
    baseline: selectedHitRules(prepared.value.baseline),
    rawAdded: full.value.addedLightningDamage.raw,
    effectiveness: full.value.addedLightningDamage.effectiveness,
    effectiveAdded: full.value.addedLightningDamage.effective,
    combinedBase: full.value.addedLightningDamage.combinedBase,
    damageIncrease: hit.increasedDamagePercent,
    speedIncrease: input.modifiers
      .filter((modifier) => modifier.statId === CAST_SPEED)
      .reduce((sum, modifier) => sum + modifier.value, 0),
    supportEffects: copySupportEffects(full.value.supportEffects),
    baseChancePercent: full.value.criticalEffects.baseChancePercent,
    increasedChancePercent: full.value.criticalEffects.increasedChancePercent,
    addedMultiplierPercent: full.value.criticalEffects.addedMultiplierPercent,
    criticalEffects: copyCriticalEffects(full.value.criticalEffects),
    resistanceEffects: copyResistanceEffects(full.value.resistanceEffects),
    shockEffects: copyShockEffects(full.value.shockEffects),
    resistanceStages: {
      exposurePercent: full.value.resistanceEffects.exposurePercent,
      selectedExposureIndices: [...full.value.resistanceEffects.selectedExposureIndices],
      uncappedResistancePercent: full.value.resistanceEffects.uncappedResistancePercent,
      maximumResistancePercent: full.value.resistanceEffects.maximumResistancePercent,
      minimumResistancePercent: full.value.resistanceEffects.minimumResistancePercent,
      cappedResistancePercent: full.value.resistanceEffects.cappedResistancePercent,
      penetrationPercent: full.value.resistanceEffects.penetrationPercent,
      effectiveResistancePercent: full.value.resistanceEffects.effectiveResistancePercent,
    },
    before: hit.nonCriticalHitBeforeResistance,
    after: hit.nonCriticalHitAfterResistance,
    castTime: hit.castTimeSeconds,
    casts: hit.castsPerSecond,
  };
  let current: IncrementalSelectedSkillReport = immutable({
    calculation: {
      ...full.value,
      skill: accepted.skill,
      supportEffects: cache.supportEffects,
      criticalEffects: cache.criticalEffects,
      resistanceEffects: cache.resistanceEffects,
      shockEffects: cache.shockEffects,
      hit: {
        ...full.value.hit,
        sourceRows: full.value.hit.sourceRows.map((row) => ({ ...row })),
      },
    },
    recalculated: plan.value.filter((id) => DERIVED.has(id)),
    dependencies,
  });

  function recalculate(nextInput: SelectedSkillInput): Result<IncrementalSelectedSkillReport> {
    const validated = validateSelectedSkillInput(nextInput);
    if (!validated.ok) return validated;
    if (!sameSnapshot(nextInput.identity, captured.identity)) {
      return failure(
        errorDiagnostic(
          'input.snapshot-mismatch',
          'A session retains its exact original snapshot.',
        ),
      );
    }
    const next = immutable(copyInput(validated.value));
    const nextDependencies = immutable(graph(next));
    const nextPlan = planCalculationGraph(nextDependencies);
    if (!nextPlan.ok) return nextPlan;
    const previousRoots = inputNodes(accepted);
    const nextRoots = inputNodes(next);
    const dirty = new Set<string>();
    for (const id of Object.keys(nextRoots)) {
      if (!equal(previousRoots[id], nextRoots[id])) dirty.add(id);
    }
    for (const id of nextPlan.value) {
      if (
        !equal(dependencies[id], nextDependencies[id]) ||
        nextDependencies[id]!.some((read) => dirty.has(read))
      ) {
        dirty.add(id);
      }
    }
    const recalculated = nextPlan.value.filter((id) => DERIVED.has(id) && dirty.has(id));
    if (!recalculated.length) {
      current = immutable({ calculation: current.calculation, recalculated: [], dependencies });
      return success(current);
    }
    let {
      baseline,
      rawAdded,
      effectiveness,
      effectiveAdded,
      combinedBase,
      damageIncrease,
      speedIncrease,
      supportEffects,
      baseChancePercent,
      increasedChancePercent,
      addedMultiplierPercent,
      criticalEffects,
      resistanceEffects,
      shockEffects,
      before,
      after,
      castTime,
      casts,
    } = cache;
    let {
      exposurePercent,
      selectedExposureIndices,
      uncappedResistancePercent,
      maximumResistancePercent,
      minimumResistancePercent,
      cappedResistancePercent,
      penetrationPercent,
      effectiveResistancePercent,
    } = cache.resistanceStages;
    for (const id of recalculated) {
      switch (id) {
        case 'base': {
          const base = prepareSelectedSkill(next, captured);
          if (!base.ok) return base;
          baseline = selectedHitRules(base.value.baseline);
          effectiveness = base.value.addedDamageEffectiveness;
          baseChancePercent = base.value.baseCriticalStrikeChancePercent;
          break;
        }
        case 'added-lightning':
          rawAdded = range(
            (next.addedLightningDamage ?? []).reduce((sum, group) => sum + group.values[0], 0),
            (next.addedLightningDamage ?? []).reduce((sum, group) => sum + group.values[1], 0),
          );
          break;
        case 'effective-added-lightning':
          effectiveAdded = range(rawAdded.min * effectiveness, rawAdded.max * effectiveness);
          break;
        case 'combined-base':
          combinedBase = range(
            baseline.baseLightningDamage.min + effectiveAdded.min,
            baseline.baseLightningDamage.max + effectiveAdded.max,
          );
          break;
        case 'damage-increase':
          damageIncrease = next.modifiers
            .filter((modifier) => DAMAGE_STATS.has(modifier.statId))
            .reduce((sum, modifier) => sum + modifier.value, 0);
          break;
        case 'cast-speed-increase':
          speedIncrease = next.modifiers
            .filter((modifier) => modifier.statId === CAST_SPEED)
            .reduce((sum, modifier) => sum + modifier.value, 0);
          break;
        case 'support-effects': {
          const effects = calculateSelectedSkillSupports(next, captured);
          if (!effects.ok) return effects;
          supportEffects = effects.value;
          break;
        }
        case 'critical-chance-increase':
          increasedChancePercent = next.modifiers
            .filter((modifier) => CRITICAL_CHANCE_STATS.has(modifier.statId))
            .reduce((sum, modifier) => sum + modifier.value, 0);
          break;
        case 'critical-multiplier-increase':
          addedMultiplierPercent = next.modifiers
            .filter((modifier) => modifier.statId === CRITICAL_MULTIPLIER)
            .reduce((sum, modifier) => sum + modifier.value, 0);
          break;
        case 'lightning-exposure': {
          const selected = selectLightningExposure(
            next.configuration.lightningResistance?.exposures ?? [],
          );
          exposurePercent = selected.exposurePercent;
          selectedExposureIndices = selected.selectedExposureIndices;
          break;
        }
        case 'lightning-penetration':
          penetrationPercent = next.modifiers
            .filter((modifier) => modifier.statId === LIGHTNING_PENETRATION)
            .reduce((sum, modifier) => sum + modifier.value, 0);
          break;
        case 'uncapped-resistance':
          uncappedResistancePercent =
            next.configuration.lightningResistance === undefined
              ? next.configuration.effectiveLightningResistancePercent!
              : next.configuration.lightningResistance.baseResistancePercent + exposurePercent;
          break;
        case 'capped-resistance': {
          const raw = next.configuration.lightningResistance;
          if (raw === undefined) {
            maximumResistancePercent = null;
            minimumResistancePercent = null;
            cappedResistancePercent = uncappedResistancePercent;
          } else {
            const capped = capLightningResistance(
              raw.baseResistancePercent,
              uncappedResistancePercent,
              raw.maximumResistanceMode,
            );
            maximumResistancePercent = capped.maximumResistancePercent;
            minimumResistancePercent = capped.minimumResistancePercent;
            cappedResistancePercent = capped.cappedResistancePercent;
          }
          break;
        }
        case 'effective-resistance':
          effectiveResistancePercent =
            next.configuration.lightningResistance === undefined
              ? next.configuration.effectiveLightningResistancePercent!
              : cappedResistancePercent - penetrationPercent;
          break;
        case 'resistance-effects': {
          const effects = assembleSelectedSkillResistance(next, captured, {
            exposurePercent,
            selectedExposureIndices,
            uncappedResistancePercent,
            maximumResistancePercent,
            minimumResistancePercent,
            cappedResistancePercent,
            penetrationPercent,
            effectiveResistancePercent,
          });
          if (!effects.ok) return effects;
          resistanceEffects = effects.value;
          break;
        }
        case 'damage-before-resistance': {
          const scale = Math.max(0, 1 + damageIncrease / 100);
          before = range(
            Math.floor(combinedBase.min * scale * supportEffects.spellDamageMultiplier + 0.5),
            Math.floor(combinedBase.max * scale * supportEffects.spellDamageMultiplier + 0.5),
          );
          break;
        }
        case 'damage-after-resistance': {
          const scale = 1 - effectiveResistancePercent / 100;
          after = { min: before.min * scale, max: before.max * scale, mean: before.mean * scale };
          break;
        }
        case 'cast-rate': {
          const totalCastSpeedPercent = speedIncrease + supportEffects.increasedCastSpeedPercent;
          const speedMultiplier = Math.floor((1 + totalCastSpeedPercent / 100) * 100 + 0.5) / 100;
          if (
            !Number.isFinite(totalCastSpeedPercent) ||
            !Number.isFinite(speedMultiplier) ||
            speedMultiplier <= 0
          ) {
            return failure(
              errorDiagnostic(
                'selected.cast-speed',
                'The rounded combined item and support cast-speed multiplier must be finite and positive.',
              ),
            );
          }
          casts = Math.min(
            speedMultiplier / (baseline.baseCastTimeSeconds * supportEffects.castTimeMultiplier),
            1 / 0.033,
          );
          castTime = 1 / casts;
          break;
        }
        case 'critical-effects': {
          const effects = calculateSelectedSkillCriticalEffects(
            next,
            {
              ...baseline,
              nonCriticalHitBeforeResistance: before,
              nonCriticalHitAfterResistance: after,
            },
            supportEffects,
            baseChancePercent,
            captured.critical,
            { increasedChancePercent, addedMultiplierPercent },
            resistanceEffects,
          );
          if (!effects.ok) return effects;
          criticalEffects = effects.value;
          break;
        }
        case 'shock-effects': {
          const effects = calculateSelectedSkillShockEffects(
            next,
            {
              ...baseline,
              nonCriticalHitBeforeResistance: before,
              nonCriticalHitAfterResistance: after,
              effectiveLightningResistancePercent: resistanceEffects.effectiveResistancePercent,
            },
            criticalEffects,
            captured.shock,
          );
          if (!effects.ok) return effects;
          shockEffects = effects.value;
          break;
        }
      }
    }
    if (
      ![
        damageIncrease,
        speedIncrease,
        rawAdded.min,
        rawAdded.max,
        rawAdded.mean,
        effectiveness,
        effectiveAdded.min,
        effectiveAdded.max,
        effectiveAdded.mean,
        combinedBase.min,
        combinedBase.max,
        combinedBase.mean,
        before.min,
        before.max,
        before.mean,
        after.min,
        after.max,
        after.mean,
        castTime,
        casts,
        supportEffects.spellDamageMultiplier,
        supportEffects.criticalChanceMultiplier,
        supportEffects.castTimeMultiplier,
        supportEffects.manaCostMultiplier,
        supportEffects.increasedCastSpeedPercent,
        baseChancePercent,
        increasedChancePercent,
        addedMultiplierPercent,
      ].every(Number.isFinite)
    ) {
      return failure(
        errorDiagnostic('input.numeric-overflow', 'The update exceeds finite numeric limits.'),
      );
    }
    const assembled = assembleSelectedSkill(
      next,
      {
        ...baseline,
        nonCriticalHitBeforeResistance: before,
        nonCriticalHitAfterResistance: after,
        castTimeSeconds: castTime,
        castsPerSecond: casts,
        effectiveLightningResistancePercent: resistanceEffects.effectiveResistancePercent,
        increasedDamagePercent: damageIncrease,
        increasedCastSpeedPercent: speedIncrease + supportEffects.increasedCastSpeedPercent,
        modifierContributions: next.modifiers
          .filter((modifier) =>
            (SPARK_MODIFIER_STAT_IDS as readonly string[]).includes(modifier.statId),
          )
          .map((modifier) => ({
            statId: modifier.statId,
            value: modifier.value,
            source: { ...modifier.source },
            scope: 'global',
          })),
      },
      {
        raw: rawAdded,
        effectiveness,
        effective: effectiveAdded,
        combinedBase,
        contributions: next.addedLightningDamage ?? [],
      },
      supportEffects,
      criticalEffects,
      resistanceEffects,
      shockEffects,
    );
    if (!assembled.ok) return assembled;
    accepted = next;
    dependencies = nextDependencies;
    cache = {
      baseline,
      rawAdded,
      effectiveness,
      effectiveAdded,
      combinedBase,
      damageIncrease,
      speedIncrease,
      supportEffects,
      baseChancePercent,
      increasedChancePercent,
      addedMultiplierPercent,
      criticalEffects,
      resistanceEffects,
      shockEffects,
      resistanceStages: {
        exposurePercent,
        selectedExposureIndices,
        uncappedResistancePercent,
        maximumResistancePercent,
        minimumResistancePercent,
        cappedResistancePercent,
        penetrationPercent,
        effectiveResistancePercent,
      },
      before,
      after,
      castTime,
      casts,
    };
    current = immutable({ calculation: assembled.value, recalculated, dependencies });
    return success(current);
  }

  return success(
    Object.freeze({
      get current() {
        return current;
      },
      recalculate,
    }),
  );
}
