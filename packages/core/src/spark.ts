import {
  SPARK_MODIFIER_STAT_IDS,
  type CatalogReader,
  type CatalogRecord,
  type CatalogRef,
  type DamageRange,
  type Diagnostic,
  type GameId,
  type Result,
  type SourceRef,
  type SourceRowRef,
  type SparkCalculation,
  type SparkDataset,
  type SparkInput,
  type SparkLevel,
  type SparkQualityStat,
  type StatContribution,
} from './types.js';
import { errorDiagnostic, failure, isSnapshotIdentity, sameSnapshot, success } from './result.js';
import { SPARK_ADDED_LIGHTNING_STAT_IDS } from './selected-skill.js';

const MIN_STAT = 'spell_minimum_base_lightning_damage';
const MAX_STAT = 'spell_maximum_base_lightning_damage';
const CAST_STAT = 'base_cast_speed_+%';
const QUALITY_STATS = new Set(['base_number_of_projectiles', 'base_projectile_speed_+%']);
// These intrinsic facts affect presentation, movement or projectile geometry,
// rather than the isolated hit. New intrinsic mechanics require explicit review.
const NON_HIT_INTRINSIC_STATS = new Set([
  'base_is_projectile',
  'quality_display_base_number_of_projectiles_is_gem',
  'base_skill_effect_duration',
  'base_number_of_projectiles',
  'projectiles_should_collide_with_flying_monsters',
  'projectile_uses_contact_position',
  'projectile_uses_contact_direction',
  'check_for_targets_between_initiator_and_projectile_source',
  'can_perform_skill_while_moving',
  'spark_pathing_width_bounds',
  'damage_hit_effect_index',
  'movement_speed_+%_final_while_performing_action',
  'movement_speed_acceleration_+%_per_second_while_performing_action',
  'movement_speed_while_performing_action_locked_duration_%',
  'spark_min_time_between_target_clearing_ms',
]);
const RULE_PROVENANCE = [
  'Base hit values: original client GrantedEffectStatSetsPerLevel.BaseResolvedValues joined to FloatStats; no PoB damage catalog is used.',
  'Unconditional increases add; noncritical one-hit damage is multiplied by (1 + total applicable increase / 100), then by (1 - effective lightning resistance / 100).',
  'Cast time: GrantedEffects.CastTime milliseconds / 1000, divided by (1 + total increased cast speed / 100). This does not establish sustained DPS.',
] as const;

function recordObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function numberField(record: CatalogRecord, name: string): number {
  const value = record.fields[name];
  if (!finite(value)) throw new Error(`${record.key}.${name} must be a finite number.`);
  return value;
}

function arrayField(record: CatalogRecord, name: string): readonly unknown[] {
  const value = record.fields[name];
  if (!Array.isArray(value)) throw new Error(`${record.key}.${name} must be an array.`);
  return value;
}

function ref(value: unknown, table: string): CatalogRef {
  if (
    !recordObject(value) ||
    value.kind !== 'ref' ||
    value.table !== table ||
    typeof value.key !== 'string' ||
    !Number.isSafeInteger(value.rowIndex)
  ) {
    throw new Error(`Expected an included ${table} reference.`);
  }
  return value as unknown as CatalogRef;
}

function matches(value: unknown, record: CatalogRecord, table: string): boolean {
  if (!recordObject(value) || value.kind !== 'ref') return false;
  return value.table === table && value.key === record.key && value.rowIndex === record.rowIndex;
}

function rowRef(table: string, record: CatalogRecord): SourceRowRef {
  return { table, key: record.key, rowIndex: record.rowIndex };
}

async function requireResolved(
  reader: CatalogReader,
  value: unknown,
  table: string,
): Promise<CatalogRecord> {
  const reference = ref(value, table);
  const record = await reader.resolve(reference);
  if (!record || record.key !== reference.key || record.rowIndex !== reference.rowIndex) {
    throw new Error(`Missing or mismatched ${table} reference ${reference.key}.`);
  }
  return record;
}

/** Shared normalization infrastructure; game entry points supply the expected game. */
export async function loadSparkDatasetForGame(
  reader: CatalogReader,
  game: GameId,
): Promise<Result<SparkDataset>> {
  if (!isSnapshotIdentity(reader.identity) || reader.identity.game !== game) {
    return failure(
      errorDiagnostic(
        'dataset.game-mismatch',
        `Expected a ${game} snapshot with an exact identity.`,
      ),
    );
  }
  const identity = { ...reader.identity };
  try {
    const effectId = game === 'poe1' ? 'Spark' : 'SparkPlayer';
    const effect = await reader.getRecord('GrantedEffects', effectId);
    if (!effect || effect.fields.Id !== effectId || effect.fields.IsSupport !== false) {
      throw new Error(`Missing normal skill ${effectId}.`);
    }
    const statSet = await requireResolved(
      reader,
      effect.fields[game === 'poe1' ? 'StatSet1' : 'StatSet'],
      'GrantedEffectStatSets',
    );
    if (statSet.fields.Id !== effectId)
      throw new Error('The primary Spark statset identity does not match the skill.');
    const baseCastTimeSeconds = numberField(effect, 'CastTime') / 1000;
    if (baseCastTimeSeconds <= 0) throw new Error('Spark cast time must be positive.');
    const [statRecords, effectLevels, statLevels, qualityRows] = await Promise.all([
      reader.getTable('Stats'),
      reader.getTable('GrantedEffectsPerLevel'),
      reader.getTable('GrantedEffectStatSetsPerLevel'),
      reader.getTable('GrantedEffectQualityStats'),
    ]);
    const stats = new Map(statRecords.map((record) => [record.key, record]));
    for (const statId of [
      ...SPARK_MODIFIER_STAT_IDS,
      MIN_STAT,
      MAX_STAT,
      ...(game === 'poe1' ? SPARK_ADDED_LIGHTNING_STAT_IDS : []),
    ]) {
      const stat = stats.get(statId);
      if (!stat || stat.fields.Id !== statId) throw new Error(`Missing exact game stat ${statId}.`);
      if (
        (
          [
            ...SPARK_MODIFIER_STAT_IDS,
            ...(game === 'poe1' ? SPARK_ADDED_LIGHTNING_STAT_IDS : []),
          ] as readonly string[]
        ).includes(statId) &&
        (stat.fields.IsLocal === true || stat.fields.IsWeaponLocal === true)
      ) {
        throw new Error(`Supported modifier ${statId} unexpectedly has local semantics.`);
      }
    }
    const intrinsicRows: SourceRowRef[] = [];
    const verifyNonHitStats = (references: readonly unknown[], values?: readonly unknown[]) => {
      if (values && references.length !== values.length)
        throw new Error('Intrinsic stat/value arrays differ.');
      for (let index = 0; index < references.length; index++) {
        const reference = ref(references[index], 'Stats');
        const stat = stats.get(reference.key);
        if (
          !stat ||
          stat.rowIndex !== reference.rowIndex ||
          stat.fields.Id !== reference.key ||
          !NON_HIT_INTRINSIC_STATS.has(reference.key) ||
          (values && !finite(values[index]))
        ) {
          throw new Error(`Unsupported or unverified intrinsic Spark stat ${reference.key}.`);
        }
        intrinsicRows.push(rowRef('Stats', stat));
      }
    };
    verifyNonHitStats(arrayField(statSet, 'ImplicitStats'));
    verifyNonHitStats(
      arrayField(statSet, 'ConstantStats'),
      arrayField(statSet, 'ConstantStatsValues'),
    );
    if (statSet.fields.IgnoredStats !== undefined && arrayField(statSet, 'IgnoredStats').length) {
      throw new Error('Primary Spark statset has unsupported stat removals.');
    }
    const levels: SparkLevel[] = [];
    for (const row of statLevels) {
      if (!matches(row.fields.StatSet, statSet, 'GrantedEffectStatSets')) continue;
      const gemLevel = numberField(row, 'GemLevel');
      if (!Number.isSafeInteger(gemLevel) || gemLevel < 1 || gemLevel > 40) continue;
      const perEffect = effectLevels.filter(
        (level) =>
          matches(level.fields.GrantedEffect, effect, 'GrantedEffects') &&
          level.fields.Level === gemLevel,
      );
      if (perEffect.length !== 1)
        throw new Error(`Spark level ${gemLevel} lacks a unique granted-effect row.`);
      const floatStats = arrayField(row, 'FloatStats');
      const resolved = arrayField(row, 'BaseResolvedValues');
      verifyNonHitStats(
        arrayField(row, 'AdditionalStats'),
        arrayField(row, 'AdditionalStatsValues'),
      );
      if (floatStats.length !== resolved.length)
        throw new Error(`Spark level ${gemLevel} has mismatched resolved stat arrays.`);
      let min: number | undefined;
      let max: number | undefined;
      const statSourceRows: SourceRowRef[] = [];
      for (let index = 0; index < floatStats.length; index++) {
        const reference = ref(floatStats[index], 'Stats');
        const stat = stats.get(reference.key);
        if (!stat || stat.rowIndex !== reference.rowIndex || stat.fields.Id !== reference.key) {
          throw new Error(`Spark level ${gemLevel} refers to an unverified stat.`);
        }
        const value = resolved[index];
        if (!finite(value) || value < 0)
          throw new Error(`Spark level ${gemLevel} has invalid resolved base damage.`);
        if (reference.key === MIN_STAT) {
          if (min !== undefined) throw new Error('Duplicate minimum base lightning stat.');
          min = value;
          statSourceRows.push(rowRef('Stats', stat));
        } else if (reference.key === MAX_STAT) {
          if (max !== undefined) throw new Error('Duplicate maximum base lightning stat.');
          max = value;
          statSourceRows.push(rowRef('Stats', stat));
        } else {
          throw new Error(`Unsupported intrinsic Spark damage stat ${reference.key}.`);
        }
      }
      if (min === undefined || max === undefined || min > max)
        throw new Error(`Spark level ${gemLevel} lacks a valid lightning range.`);
      if (levels.some((level) => level.gemLevel === gemLevel))
        throw new Error(`Duplicate Spark gem level ${gemLevel}.`);
      let addedDamageEffectiveness: number | undefined;
      if (game === 'poe1') {
        const rawEffectiveness = numberField(row, 'DamageEffectiveness');
        addedDamageEffectiveness = 1 + rawEffectiveness / 10_000;
        if (
          !Number.isSafeInteger(rawEffectiveness) ||
          addedDamageEffectiveness < 0 ||
          !finite(addedDamageEffectiveness)
        )
          throw new Error(`Spark level ${gemLevel} has invalid added-damage effectiveness.`);
      }
      levels.push({
        gemLevel,
        baseLightningMin: min,
        baseLightningMax: max,
        ...(addedDamageEffectiveness === undefined ? {} : { addedDamageEffectiveness }),
        sourceRows: [
          rowRef('GrantedEffectStatSetsPerLevel', row),
          rowRef('GrantedEffectsPerLevel', perEffect[0]!),
          ...statSourceRows,
        ],
      });
    }
    if (levels.length !== 40)
      throw new Error('Normal Spark must have every gem level from 1 through 40.');
    levels.sort((left, right) => left.gemLevel - right.gemLevel);
    const qualityStats: SparkQualityStat[] = [];
    for (const row of qualityRows) {
      if (
        !matches(
          row.fields[game === 'poe1' ? 'GrantedEffectsKey' : 'GrantedEffect'],
          effect,
          'GrantedEffects',
        )
      )
        continue;
      if (game === 'poe2') {
        const targets = arrayField(row, 'ApplyToStatSets');
        if (targets.length && !targets.includes(0)) continue;
        if (arrayField(row, 'AddTypes').length || arrayField(row, 'AddMinionTypes').length) {
          throw new Error('Spark ordinary quality adds unsupported skill types.');
        }
      }
      const statRefs = arrayField(row, game === 'poe1' ? 'StatsKeys' : 'Stats');
      const values = arrayField(row, 'StatsValuesPermille');
      if (statRefs.length !== values.length)
        throw new Error('Spark quality stat/value arrays differ.');
      for (let index = 0; index < statRefs.length; index++) {
        const stat = await requireResolved(reader, statRefs[index], 'Stats');
        const value = values[index];
        if (!QUALITY_STATS.has(stat.key) || !finite(value))
          throw new Error(`Unsupported ordinary Spark quality stat ${stat.key}.`);
        qualityStats.push({
          statId: stat.key,
          valuePerQuality: value / 1000,
          sourceRows: [rowRef('GrantedEffectQualityStats', row), rowRef('Stats', stat)],
        });
      }
    }
    if (!qualityStats.length) throw new Error('Missing verified ordinary Spark quality stats.');
    if (!sameSnapshot(identity, reader.identity)) {
      throw new Error('The catalog snapshot changed while Spark data was loading.');
    }
    const value: SparkDataset = {
      identity,
      baseDamageAuthority: 'client-resolved',
      grantedEffectId: effectId,
      statSetId: statSet.key,
      baseCastTimeSeconds,
      supportedModifierStatIds: [...SPARK_MODIFIER_STAT_IDS],
      levels,
      qualityStats,
      sourceRows: [
        rowRef('GrantedEffects', effect),
        rowRef('GrantedEffectStatSets', statSet),
        ...(game === 'poe1'
          ? SPARK_ADDED_LIGHTNING_STAT_IDS.map((statId) => rowRef('Stats', stats.get(statId)!))
          : []),
        ...intrinsicRows.filter(
          (row, index, rows) =>
            rows.findIndex(
              (other) => other.table === row.table && other.rowIndex === row.rowIndex,
            ) === index,
        ),
      ],
      ruleProvenance: [
        ...RULE_PROVENANCE,
        ...(game === 'poe1'
          ? [
              'PoE1 added-damage effectiveness: original client GrantedEffectStatSetsPerLevel.DamageEffectiveness / 10000 + 1; exact spell added-lightning stat pair verified in Stats. The isolated-hit API does not apply added damage.',
            ]
          : []),
        `Modifier semantics reference: https://github.com/PathOfBuildingCommunity/${game === 'poe1' ? 'PathOfBuilding' : 'PathOfBuilding-PoE2'}/blob/${game === 'poe1' ? '3dbca4463c0a59079d9f7f032d8240cf868e09da' : 'bb52d6b368307457eb9c54bb13f1829993d390b1'}/src/Data/SkillStatMap.lua`,
      ],
    };
    return success(value);
  } catch (cause) {
    return failure(
      errorDiagnostic(
        'dataset.invalid-spark-data',
        cause instanceof Error ? cause.message : 'Could not read verified Spark data.',
      ),
    );
  }
}

const INPUT_KEYS = new Set([
  'identity',
  'gemLevel',
  'quality',
  'variant',
  'statSet',
  'modifiers',
  'supports',
  'effectiveLightningResistancePercent',
]);
const MODIFIER_KEYS = new Set(['statId', 'value', 'source', 'scope', 'conditions']);
const SOURCE_KINDS = new Set(['item', 'skill', 'quality', 'scenario', 'external']);

function validSource(value: unknown): value is SourceRef {
  return (
    recordObject(value) &&
    typeof value.kind === 'string' &&
    SOURCE_KINDS.has(value.kind) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.id.length <= 1024 &&
    (value.label === undefined || typeof value.label === 'string') &&
    (value.line === undefined || (Number.isSafeInteger(value.line) && (value.line as number) >= 1))
  );
}

function damageRange(min: number, max: number): DamageRange {
  return { min, max, mean: (min + max) / 2 };
}

function validSourceRows(value: unknown): value is readonly SourceRowRef[] {
  return (
    Array.isArray(value) &&
    value.length <= 10_000 &&
    value.every(
      (row) =>
        recordObject(row) &&
        typeof row.table === 'string' &&
        row.table.length > 0 &&
        typeof row.key === 'string' &&
        row.key.length > 0 &&
        Number.isSafeInteger(row.rowIndex) &&
        (row.rowIndex as number) >= 0,
    )
  );
}

/** No I/O or hidden configuration: one normal, noncritical hit against an explicit scenario. */
export function calculateSparkForGame(
  input: SparkInput,
  dataset: SparkDataset,
  game: GameId,
): Result<SparkCalculation> {
  const diagnostics: Diagnostic[] = [];
  if (!recordObject(input))
    return failure(errorDiagnostic('input.invalid', 'Spark input must be an object.'));
  if (
    !recordObject(dataset) ||
    dataset.baseDamageAuthority !== 'client-resolved' ||
    !Array.isArray(dataset.levels) ||
    dataset.levels.length !== 40 ||
    !Array.isArray(dataset.supportedModifierStatIds) ||
    !Array.isArray(dataset.qualityStats) ||
    dataset.qualityStats.length > 100 ||
    !validSourceRows(dataset.sourceRows) ||
    !Array.isArray(dataset.ruleProvenance) ||
    dataset.ruleProvenance.length > 100 ||
    !dataset.ruleProvenance.every((line) => typeof line === 'string') ||
    dataset.grantedEffectId !== (game === 'poe1' ? 'Spark' : 'SparkPlayer') ||
    dataset.statSetId !== dataset.grantedEffectId
  ) {
    return failure(
      errorDiagnostic('dataset.invalid-spark-data', 'A normalized Spark dataset is required.'),
    );
  }
  for (const key of Object.keys(input)) {
    if (!INPUT_KEYS.has(key))
      diagnostics.push(
        errorDiagnostic('input.unsupported-field', `Unsupported Spark input field: ${key}.`),
      );
  }
  if (
    !isSnapshotIdentity(input.identity) ||
    !isSnapshotIdentity(dataset.identity) ||
    input.identity.game !== game ||
    dataset.identity.game !== game ||
    !sameSnapshot(input.identity, dataset.identity)
  ) {
    diagnostics.push(
      errorDiagnostic(
        'input.snapshot-mismatch',
        'Input and dataset must match game, build and snapshot exactly.',
      ),
    );
  }
  if (!Number.isSafeInteger(input.gemLevel) || input.gemLevel < 1 || input.gemLevel > 40) {
    diagnostics.push(
      errorDiagnostic('input.gem-level', 'Supported gem levels are integers from 1 through 40.'),
    );
  }
  const quality = input.quality ?? 0;
  if (!Number.isSafeInteger(quality) || quality < 0 || quality > 100) {
    diagnostics.push(
      errorDiagnostic('input.quality', 'Ordinary quality must be an integer from 0 through 100.'),
    );
  }
  if (
    (input.variant !== undefined && input.variant !== 'normal') ||
    (input.statSet !== undefined && input.statSet !== 'base')
  ) {
    diagnostics.push(
      errorDiagnostic(
        'input.unsupported-mode',
        'Only normal Spark and its Base statset are supported.',
      ),
    );
  }
  if (
    input.supports !== undefined &&
    (!Array.isArray(input.supports) || input.supports.length > 0)
  ) {
    diagnostics.push(
      errorDiagnostic(
        'input.unsupported-support',
        'Support gems are not implemented in this single-hit slice.',
      ),
    );
  }
  const resistance = input.effectiveLightningResistancePercent;
  if (!finite(resistance) || resistance < -200 || resistance > 100) {
    diagnostics.push(
      errorDiagnostic(
        'input.resistance',
        'Explicit effective resistance must be finite and between -200% and 100%. No resistance cap is inferred.',
      ),
    );
  }
  const modifiers: StatContribution[] = [];
  if (
    input.modifiers !== undefined &&
    (!Array.isArray(input.modifiers) || input.modifiers.length > 1000)
  ) {
    diagnostics.push(
      errorDiagnostic(
        'input.modifiers',
        'Modifiers must be an array with at most 1000 contributions.',
      ),
    );
  } else {
    for (const candidate of input.modifiers ?? []) {
      if (
        !recordObject(candidate) ||
        typeof candidate.statId !== 'string' ||
        !finite(candidate.value) ||
        !validSource(candidate.source)
      ) {
        diagnostics.push(
          errorDiagnostic(
            'input.invalid-modifier',
            'Each modifier needs an exact stat ID, finite value and source identity.',
          ),
        );
        continue;
      }
      if (
        Object.keys(candidate).some((key) => !MODIFIER_KEYS.has(key)) ||
        candidate.scope === 'local' ||
        (candidate.scope !== undefined && candidate.scope !== 'global') ||
        (candidate.conditions !== undefined &&
          (!Array.isArray(candidate.conditions) || candidate.conditions.length > 0))
      ) {
        diagnostics.push({
          ...errorDiagnostic(
            'input.unsupported-modifier-context',
            'Local, conditional and extra modifier semantics are not implemented.',
          ),
          source: candidate.source,
        });
        continue;
      }
      if (
        !(SPARK_MODIFIER_STAT_IDS as readonly string[]).includes(candidate.statId) ||
        !(dataset.supportedModifierStatIds as readonly string[]).includes(candidate.statId)
      ) {
        diagnostics.push({
          ...errorDiagnostic(
            'input.unsupported-stat',
            `Unsupported calculation stat: ${candidate.statId}.`,
          ),
          source: candidate.source,
        });
        continue;
      }
      modifiers.push({
        statId: candidate.statId,
        value: candidate.value,
        source: { ...candidate.source },
        scope: 'global',
      });
    }
  }
  if (diagnostics.length) return { ok: false, diagnostics };
  const levelNumbers = new Set<number>();
  if (
    !dataset.levels.every((candidate) => {
      if (
        !recordObject(candidate) ||
        !finite(candidate.gemLevel) ||
        !Number.isSafeInteger(candidate.gemLevel) ||
        candidate.gemLevel < 1 ||
        candidate.gemLevel > 40 ||
        levelNumbers.has(candidate.gemLevel) ||
        !validSourceRows(candidate.sourceRows)
      )
        return false;
      levelNumbers.add(candidate.gemLevel);
      return (
        finite(candidate.baseLightningMin) &&
        finite(candidate.baseLightningMax) &&
        candidate.baseLightningMin >= 0 &&
        candidate.baseLightningMax >= candidate.baseLightningMin
      );
    }) ||
    !dataset.qualityStats.every(
      (stat) =>
        recordObject(stat) &&
        typeof stat.statId === 'string' &&
        QUALITY_STATS.has(stat.statId) &&
        finite(stat.valuePerQuality) &&
        finite(stat.valuePerQuality * quality) &&
        validSourceRows(stat.sourceRows),
    )
  ) {
    return failure(
      errorDiagnostic(
        'dataset.invalid-spark-data',
        'Normalized level, quality or provenance facts are malformed.',
      ),
    );
  }
  const level = dataset.levels.find((candidate) => candidate.gemLevel === input.gemLevel);
  if (
    !level ||
    !finite(level.baseLightningMin) ||
    !finite(level.baseLightningMax) ||
    level.baseLightningMin < 0 ||
    level.baseLightningMax < level.baseLightningMin ||
    !finite(dataset.baseCastTimeSeconds) ||
    dataset.baseCastTimeSeconds <= 0
  ) {
    return failure(
      errorDiagnostic(
        'dataset.invalid-spark-data',
        'The normalized dataset lacks a valid selected level or cast time.',
      ),
    );
  }
  const increasedDamagePercent = modifiers
    .filter((modifier) => modifier.statId !== CAST_STAT)
    .reduce((total, modifier) => total + modifier.value, 0);
  const increasedCastSpeedPercent = modifiers
    .filter((modifier) => modifier.statId === CAST_STAT)
    .reduce((total, modifier) => total + modifier.value, 0);
  const damageScale = Math.max(0, 1 + increasedDamagePercent / 100);
  const speedScale = 1 + increasedCastSpeedPercent / 100;
  if (!finite(damageScale) || !finite(speedScale) || speedScale <= 0) {
    return failure(
      errorDiagnostic(
        'input.invalid-multiplier',
        'Damage scaling must be finite and the cast-speed multiplier must be positive.',
      ),
    );
  }
  const before = damageRange(
    level.baseLightningMin * damageScale,
    level.baseLightningMax * damageScale,
  );
  const resistanceScale = 1 - resistance / 100;
  const after = damageRange(before.min * resistanceScale, before.max * resistanceScale);
  const castTimeSeconds = dataset.baseCastTimeSeconds / speedScale;
  if (
    ![
      before.min,
      before.max,
      before.mean,
      after.min,
      after.max,
      after.mean,
      castTimeSeconds,
      1 / castTimeSeconds,
    ].every(finite)
  ) {
    return failure(
      errorDiagnostic(
        'input.numeric-overflow',
        'The requested calculation exceeds finite numeric limits.',
      ),
    );
  }
  return success({
    identity: { ...dataset.identity },
    skillId: dataset.grantedEffectId,
    gemLevel: input.gemLevel,
    quality,
    mode: 'normal-base-noncritical-single-hit',
    baseLightningDamage: damageRange(level.baseLightningMin, level.baseLightningMax),
    nonCriticalHitBeforeResistance: before,
    nonCriticalHitAfterResistance: after,
    baseCastTimeSeconds: dataset.baseCastTimeSeconds,
    castTimeSeconds,
    castsPerSecond: 1 / castTimeSeconds,
    effectiveLightningResistancePercent: resistance,
    increasedDamagePercent,
    increasedCastSpeedPercent,
    qualityStats: dataset.qualityStats.map((stat) => ({
      statId: stat.statId,
      value: stat.valuePerQuality * quality,
      source: { kind: 'quality', id: dataset.grantedEffectId },
      scope: 'global',
    })),
    modifierContributions: modifiers,
    sourceRows: [
      ...dataset.sourceRows,
      ...level.sourceRows,
      ...dataset.qualityStats.flatMap((stat) => stat.sourceRows),
    ],
    ruleProvenance: [...dataset.ruleProvenance],
  });
}
