import {
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
  prepareSelectedSkill,
  selectedHitRules,
  validateSelectedSkillInput,
} from './selected-skill.js';
import { planCalculationGraph, type CalculationDependencies } from './graph.js';

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
const DERIVED = new Set([
  'base',
  'damage-increase',
  'cast-speed-increase',
  'damage-before-resistance',
  'damage-after-resistance',
  'cast-rate',
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
      ...(input.skill.supports ? { supports: [...input.skill.supports] } : {}),
    },
    configuration: { ...input.configuration },
    modifiers: input.modifiers.map(copyModifier),
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
      sourceRows: copyRows(level.sourceRows),
    })),
    qualityStats: dataset.qualityStats.map((stat) => ({
      statId: stat.statId,
      valuePerQuality: stat.valuePerQuality,
      sourceRows: copyRows(stat.sourceRows),
    })),
    sourceRows: copyRows(dataset.sourceRows),
    ruleProvenance: [...dataset.ruleProvenance],
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
  return Object.fromEntries([
    ['input.metadata', [input.identity, input.buildId, input.configuration.id]],
    ['input.skill', input.skill],
    ['input.resistance', input.configuration.effectiveLightningResistancePercent],
    ...input.modifiers.map((modifier, index) => [`modifier:${index}`, modifier]),
  ]);
}

function graph(input: SelectedSkillInput): CalculationDependencies {
  const roots = inputNodes(input);
  const damage: string[] = [];
  const speed: string[] = [];
  input.modifiers.forEach((modifier, index) => {
    (modifier.statId === CAST_SPEED ? speed : damage).push(`modifier:${index}`);
  });
  return {
    ...Object.fromEntries(Object.keys(roots).map((id) => [id, []])),
    base: ['input.skill'],
    'damage-increase': damage,
    'cast-speed-increase': speed,
    'damage-before-resistance': ['base', 'damage-increase'],
    'damage-after-resistance': ['damage-before-resistance', 'input.resistance'],
    'cast-rate': ['base', 'cast-speed-increase'],
    'selected-skill': [
      'input.metadata',
      'input.skill',
      'input.resistance',
      ...input.modifiers.map((_, index) => `modifier:${index}`),
      'base',
      'damage-increase',
      'cast-speed-increase',
      'damage-before-resistance',
      'damage-after-resistance',
      'cast-rate',
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
  readonly damageIncrease: number;
  readonly speedIncrease: number;
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
    damageIncrease: hit.increasedDamagePercent,
    speedIncrease: hit.increasedCastSpeedPercent,
    before: hit.nonCriticalHitBeforeResistance,
    after: hit.nonCriticalHitAfterResistance,
    castTime: hit.castTimeSeconds,
    casts: hit.castsPerSecond,
  };
  let current: IncrementalSelectedSkillReport = immutable({
    calculation: {
      ...full.value,
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
    let { baseline, damageIncrease, speedIncrease, before, after, castTime, casts } = cache;
    for (const id of recalculated) {
      switch (id) {
        case 'base': {
          const base = prepareSelectedSkill(next, captured);
          if (!base.ok) return base;
          baseline = selectedHitRules(base.value.baseline);
          break;
        }
        case 'damage-increase':
          damageIncrease = next.modifiers
            .filter((modifier) => modifier.statId !== CAST_SPEED)
            .reduce((sum, modifier) => sum + modifier.value, 0);
          break;
        case 'cast-speed-increase':
          speedIncrease = next.modifiers
            .filter((modifier) => modifier.statId === CAST_SPEED)
            .reduce((sum, modifier) => sum + modifier.value, 0);
          break;
        case 'damage-before-resistance': {
          const scale = Math.max(0, 1 + damageIncrease / 100);
          before = range(
            Math.floor(baseline.baseLightningDamage.min * scale + 0.5),
            Math.floor(baseline.baseLightningDamage.max * scale + 0.5),
          );
          break;
        }
        case 'damage-after-resistance': {
          const scale = 1 - next.configuration.effectiveLightningResistancePercent / 100;
          after = { min: before.min * scale, max: before.max * scale, mean: before.mean * scale };
          break;
        }
        case 'cast-rate':
          casts = Math.min(
            Math.floor((1 + speedIncrease / 100) * 100 + 0.5) / 100 / baseline.baseCastTimeSeconds,
            1 / 0.033,
          );
          castTime = 1 / casts;
          break;
      }
    }
    if (
      ![
        damageIncrease,
        speedIncrease,
        before.min,
        before.max,
        before.mean,
        after.min,
        after.max,
        after.mean,
        castTime,
        casts,
      ].every(Number.isFinite)
    ) {
      return failure(
        errorDiagnostic('input.numeric-overflow', 'The update exceeds finite numeric limits.'),
      );
    }
    const assembled = assembleSelectedSkill(next, {
      ...baseline,
      nonCriticalHitBeforeResistance: before,
      nonCriticalHitAfterResistance: after,
      castTimeSeconds: castTime,
      castsPerSecond: casts,
      effectiveLightningResistancePercent: next.configuration.effectiveLightningResistancePercent,
      increasedDamagePercent: damageIncrease,
      increasedCastSpeedPercent: speedIncrease,
      modifierContributions: next.modifiers.map((modifier) => ({
        statId: modifier.statId,
        value: modifier.value,
        source: { ...modifier.source },
        scope: 'global',
      })),
    });
    if (!assembled.ok) return assembled;
    accepted = next;
    dependencies = nextDependencies;
    cache = { baseline, damageIncrease, speedIncrease, before, after, castTime, casts };
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
