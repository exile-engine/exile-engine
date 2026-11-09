import {
  CONTROLLED_DESTRUCTION_STAT_IDS,
  errorDiagnostic,
  failure,
  isSnapshotIdentity,
  sameSnapshot,
  success,
  type CatalogReader,
  type CatalogRecord,
  type CatalogRef,
  type Result,
  type SelectedSkillInput,
  type SelectedSkillSupportDataset,
  type SelectedSkillSupportTrace,
  type SelectedSkillSupportLevel,
  type SelectedSkillFasterCastingLevel,
  type SelectedSkillFasterCastingDataset,
  type SelectedSkillControlledDestructionDataset,
  type SelectedSkillSupportContribution,
  type SourceRowRef,
  type SparkDataset,
} from '@exile-engine/core';

const SUPPORT = 'SupportControlledDestruction';
const GEM = 'Metadata/Items/Gems/SupportGemControlledDestruction';
const FASTER = 'SupportFasterCasting';
const FASTER_GEM = 'Metadata/Items/Gems/SupportGemFasterCast';
const CAST_SPEED = 'base_cast_speed_+%';
const [MORE, CRIT] = CONTROLLED_DESTRUCTION_STAT_IDS;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const rowRef = (table: string, record: CatalogRecord): SourceRowRef => ({
  table,
  key: record.key,
  rowIndex: record.rowIndex,
});
const own = (value: Record<string, unknown>, names: readonly string[]) =>
  names.every((name) => Object.hasOwn(value, name));
const keys = (value: Record<string, unknown>, names: readonly string[]) =>
  Object.keys(value).every((name) => names.includes(name));
function dense(value: unknown, maximum: number): value is readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) return false;
  for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) return false;
  return true;
}
function rows(value: unknown): boolean {
  return (
    dense(value, 1000) &&
    value.length > 0 &&
    value.every(
      (row) =>
        object(row) &&
        own(row, ['table', 'key', 'rowIndex']) &&
        keys(row, ['table', 'key', 'rowIndex']) &&
        typeof row.table === 'string' &&
        row.table.length > 0 &&
        row.table.length <= 1024 &&
        typeof row.key === 'string' &&
        row.key.length > 0 &&
        row.key.length <= 1024 &&
        Number.isSafeInteger(row.rowIndex) &&
        (row.rowIndex as number) >= 0,
    )
  );
}

/** Exact bounded records prevent unsupported or inherited semantics from entering a session. */
export function selectedSupportDatasetShape(dataset: SparkDataset): boolean {
  if (dataset.supports === undefined) return true;
  const supportIds = new Set<string>();
  return (
    dense(dataset.supports, 2) &&
    dataset.supports.length >= 1 &&
    dataset.supports.every((data) => {
      if (
        !object(data) ||
        !own(data, ['identity', 'id', 'gemId', 'levels', 'sourceRows']) ||
        !keys(data, ['identity', 'id', 'gemId', 'levels', 'sourceRows']) ||
        (data.id !== SUPPORT && data.id !== FASTER) ||
        supportIds.has(data.id as string) ||
        data.gemId !== (data.id === SUPPORT ? GEM : FASTER_GEM) ||
        !object(data.identity) ||
        !own(data.identity, ['game', 'build', 'snapshotId']) ||
        !keys(data.identity, ['game', 'build', 'snapshotId']) ||
        !isSnapshotIdentity(data.identity) ||
        !sameSnapshot(dataset.identity, data.identity) ||
        !rows(data.sourceRows) ||
        !dense(data.levels, 20) ||
        data.levels.length !== 20
      )
        return false;
      supportIds.add(data.id);
      const seen = new Set<number>();
      return data.levels.every((level) => {
        if (
          !object(level) ||
          !own(
            level,
            data.id === SUPPORT
              ? [
                  'gemLevel',
                  'moreSpellDamagePercent',
                  'criticalStrikeChancePercent',
                  'manaCostMultiplier',
                  'sourceRows',
                ]
              : ['gemLevel', 'increasedCastSpeedPercent', 'manaCostMultiplier', 'sourceRows'],
          ) ||
          !keys(
            level,
            data.id === SUPPORT
              ? [
                  'gemLevel',
                  'moreSpellDamagePercent',
                  'criticalStrikeChancePercent',
                  'manaCostMultiplier',
                  'sourceRows',
                ]
              : ['gemLevel', 'increasedCastSpeedPercent', 'manaCostMultiplier', 'sourceRows'],
          ) ||
          !Number.isSafeInteger(level.gemLevel) ||
          (level.gemLevel as number) < 1 ||
          (level.gemLevel as number) > 20 ||
          seen.has(level.gemLevel as number) ||
          (data.id === SUPPORT
            ? !Number.isSafeInteger(level.moreSpellDamagePercent) ||
              (level.moreSpellDamagePercent as number) < 0 ||
              (level.moreSpellDamagePercent as number) > 100 ||
              level.criticalStrikeChancePercent !== -80
            : !Number.isSafeInteger(level.increasedCastSpeedPercent) ||
              (level.increasedCastSpeedPercent as number) < 0 ||
              (level.increasedCastSpeedPercent as number) > 100) ||
          typeof level.manaCostMultiplier !== 'number' ||
          !Number.isFinite(level.manaCostMultiplier) ||
          level.manaCostMultiplier <= 0 ||
          level.manaCostMultiplier > 100 ||
          !rows(level.sourceRows)
        )
          return false;
        seen.add(level.gemLevel as number);
        return true;
      });
    })
  );
}
function array(row: CatalogRecord, name: string): readonly unknown[] {
  const value = row.fields[name];
  if (!Array.isArray(value) || value.length > 1000)
    throw new Error(`Missing bounded ${row.key}.${name}.`);
  return value;
}
function reference(value: unknown, table: string): CatalogRef {
  if (
    !object(value) ||
    value.kind !== 'ref' ||
    value.table !== table ||
    typeof value.key !== 'string' ||
    !Number.isSafeInteger(value.rowIndex)
  )
    throw new Error(`Expected exact ${table} reference.`);
  return value as unknown as CatalogRef;
}
function matches(value: unknown, table: string, row: CatalogRecord): boolean {
  return (
    object(value) &&
    value.kind === 'ref' &&
    value.table === table &&
    value.key === row.key &&
    value.rowIndex === row.rowIndex
  );
}
async function resolve(
  reader: CatalogReader,
  value: unknown,
  table: string,
): Promise<CatalogRecord> {
  const ref = reference(value, table);
  const row = await reader.resolve(ref);
  if (!row || row.key !== ref.key || row.rowIndex !== ref.rowIndex)
    throw new Error(`Missing exact ${table}/${ref.key}.`);
  return row;
}

/** Read one reviewed support from the same snapshot as Spark. No formulas or paths are evaluated. */
async function loadReviewedSupportDataset(
  reader: CatalogReader,
  supportId: typeof SUPPORT | typeof FASTER,
): Promise<Result<SelectedSkillSupportDataset>> {
  if (!isSnapshotIdentity(reader.identity) || reader.identity.game !== 'poe1')
    return failure(errorDiagnostic('support.snapshot', 'A pinned PoE1 snapshot is required.'));
  const identity = { ...reader.identity };
  const faster = supportId === FASTER;
  const gemId = faster ? FASTER_GEM : GEM;
  const statIds = faster ? [CAST_SPEED] : CONTROLLED_DESTRUCTION_STAT_IDS;
  const levelStatId = faster ? CAST_SPEED : MORE;
  try {
    const effect = await reader.getRecord('GrantedEffects', supportId);
    const spark = await reader.getRecord('GrantedEffects', 'Spark');
    if (
      !effect ||
      effect.key !== supportId ||
      effect.fields.Id !== supportId ||
      effect.fields.IsSupport !== true ||
      !spark
    )
      throw new Error('Missing reviewed normal support or Spark.');
    if (spark.fields.CannotBeSupported !== false)
      throw new Error('Normal Spark cannot be supported or lacks verified eligibility.');
    for (const field of [
      'AddedActiveSkillTypes',
      'AddedMinionActiveSkillTypes',
      'SupportWeaponRestrictions',
      'StatSet2',
    ])
      if (array(effect, field).length) throw new Error(`Unsupported support context: ${field}.`);
    const allowed = array(effect, 'AllowedActiveSkillTypes').map(
      (value) => reference(value, 'ActiveSkillType').key,
    );
    const excluded = array(effect, 'ExcludedActiveSkillTypes').map(
      (value) => reference(value, 'ActiveSkillType').key,
    );
    if (
      (faster
        ? allowed.length !== 1 ||
          allowed[0] !== 'Spell' ||
          excluded.length !== 2 ||
          !['Instant', 'FixedCastTime'].every((id) => excluded.includes(id))
        : allowed.length !== 3 ||
          !['Damage', 'Attack', 'DegenOnlySpellDamage'].every((id) => allowed.includes(id)) ||
          excluded.length !== 0) ||
      effect.fields.SupportsGemsOnly !== false ||
      effect.fields.ActiveSkill !== null
    )
      throw new Error('Unsupported support eligibility semantics.');
    const active = await resolve(reader, spark.fields.ActiveSkill, 'ActiveSkills');
    const activeTypes = array(active, 'ActiveSkillTypes').map(
      (value) => reference(value, 'ActiveSkillType').key,
    );
    if (
      active.key !== 'spark' ||
      !activeTypes.includes('Spell') ||
      !activeTypes.includes('Damage') ||
      activeTypes.some((id) => excluded.includes(id)) ||
      !activeTypes.some((id) => allowed.includes(id))
    )
      throw new Error('Normal Spark is not eligible for this spell-damage support.');
    const typeRows: SourceRowRef[] = [];
    for (const value of [
      ...array(effect, 'AllowedActiveSkillTypes'),
      ...array(effect, 'ExcludedActiveSkillTypes'),
      ...array(active, 'ActiveSkillTypes'),
    ]) {
      const row = await resolve(reader, value, 'ActiveSkillType');
      if (row.fields.Id !== row.key)
        throw new Error('Mismatched support eligibility type identity.');
      if (!typeRows.some((source) => source.key === row.key))
        typeRows.push(rowRef('ActiveSkillType', row));
    }
    const set = await resolve(reader, effect.fields.StatSet1, 'GrantedEffectStatSets');
    if (
      set.key !== supportId ||
      array(set, 'ImplicitStats').length ||
      (faster
        ? array(set, 'ConstantStats').length !== 0 || array(set, 'ConstantStatsValues').length !== 0
        : array(set, 'ConstantStats').length !== 1 ||
          reference(array(set, 'ConstantStats')[0], 'Stats').key !== CRIT ||
          array(set, 'ConstantStatsValues').length !== 1 ||
          array(set, 'ConstantStatsValues')[0] !== -80)
    )
      throw new Error('Unsupported Controlled Destruction constant stats.');
    if (set.fields.IgnoredStats !== undefined && array(set, 'IgnoredStats').length)
      throw new Error('Support stat removals are unsupported.');
    const stats = await Promise.all(statIds.map((id) => reader.getRecord('Stats', id)));
    if (
      stats.some(
        (row, index) =>
          !row ||
          row.key !== statIds[index] ||
          row.fields.Id !== statIds[index] ||
          row.fields.IsLocal !== false ||
          row.fields.IsWeaponLocal !== false,
      )
    )
      throw new Error('Missing exact global support stat identities.');
    if (!faster && !matches(array(set, 'ConstantStats')[0], 'Stats', stats[1]!))
      throw new Error('Mismatched critical-chance stat row identity.');
    const [statLevels, effectLevels, gems] = await Promise.all([
      reader.getTable('GrantedEffectStatSetsPerLevel'),
      reader.getTable('GrantedEffectsPerLevel'),
      reader.getTable('SkillGems'),
    ]);
    const candidates = gems.filter(
      (row) => object(row.fields.BaseItemTypesKey) && row.fields.BaseItemTypesKey.key === gemId,
    );
    if (
      candidates.length !== 1 ||
      candidates[0]!.fields.IsSupport !== true ||
      candidates[0]!.fields.IsVaalVariant !== false
    )
      throw new Error('Missing unique normal support gem identity.');
    const gem = candidates[0]!;
    const base = await resolve(reader, gem.fields.BaseItemTypesKey, 'BaseItemTypes');
    const variants = array(gem, 'GemVariants');
    if (base.key !== gemId || variants.length !== 1)
      throw new Error('Ambiguous normal support gem.');
    const variant = await resolve(reader, variants[0], 'GemEffects');
    if (
      variant.key !== supportId ||
      !matches(variant.fields.GrantedEffect, 'GrantedEffects', effect)
    )
      throw new Error('The support gem does not grant the reviewed effect.');
    const levels: SelectedSkillSupportLevel[] = [];
    const fasterLevels: SelectedSkillFasterCastingLevel[] = [];
    for (let gemLevel = 1; gemLevel <= 20; gemLevel++) {
      const rows = statLevels.filter(
        (row) =>
          matches(row.fields.StatSet, 'GrantedEffectStatSets', set) &&
          row.fields.GemLevel === gemLevel,
      );
      const costs = effectLevels.filter(
        (row) =>
          matches(row.fields.GrantedEffect, 'GrantedEffects', effect) &&
          row.fields.Level === gemLevel,
      );
      if (rows.length !== 1 || costs.length !== 1)
        throw new Error(`Missing unique support level ${gemLevel}.`);
      const row = rows[0]!;
      const cost = costs[0]!;
      if (
        array(row, 'FloatStats').length ||
        array(row, 'BaseResolvedValues').length ||
        array(row, 'AdditionalFlags').length ||
        array(row, 'AdditionalStats').length !== 1 ||
        reference(array(row, 'AdditionalStats')[0], 'Stats').key !== levelStatId ||
        !matches(array(row, 'AdditionalStats')[0], 'Stats', stats[0]!) ||
        array(row, 'AdditionalStatsValues').length !== 1 ||
        array(row, 'FloatStatsValues').length !== 0 ||
        array(row, 'GrantedEffects').length !== 1 ||
        !matches(array(row, 'GrantedEffects')[0], 'GrantedEffects', effect)
      )
        throw new Error(`Unsupported support level ${gemLevel} stats.`);
      const more = array(row, 'AdditionalStatsValues')[0];
      const multiplier = cost.fields.CostMultiplier;
      if (
        !Number.isSafeInteger(more) ||
        (more as number) < 0 ||
        (more as number) > 100 ||
        !Number.isSafeInteger(multiplier) ||
        (multiplier as number) <= 0 ||
        (multiplier as number) > 10000 ||
        cost.fields.AttackSpeedMultiplier !== 0 ||
        cost.fields.AttackTime !== 0 ||
        cost.fields.Cooldown !== 0
      )
        throw new Error(`Invalid or unsupported support level ${gemLevel}.`);
      const sourceRows = [
        rowRef('GrantedEffectStatSetsPerLevel', row),
        rowRef('GrantedEffectsPerLevel', cost),
      ];
      if (faster)
        fasterLevels.push({
          gemLevel,
          increasedCastSpeedPercent: more as number,
          manaCostMultiplier: (multiplier as number) / 100,
          sourceRows,
        });
      else
        levels.push({
          gemLevel,
          moreSpellDamagePercent: more as number,
          criticalStrikeChancePercent: -80,
          manaCostMultiplier: (multiplier as number) / 100,
          sourceRows: [
            rowRef('GrantedEffectStatSetsPerLevel', row),
            rowRef('GrantedEffectsPerLevel', cost),
          ],
        });
    }
    if (!sameSnapshot(identity, reader.identity))
      throw new Error('Support snapshot changed while loading.');
    const sourceRows = [
      rowRef('GrantedEffects', effect),
      rowRef('GrantedEffectStatSets', set),
      rowRef('ActiveSkills', active),
      rowRef('SkillGems', gem),
      rowRef('BaseItemTypes', base),
      rowRef('GemEffects', variant),
      ...typeRows,
      ...stats.map((row) => rowRef('Stats', row!)),
    ];
    if (faster)
      return success<SelectedSkillFasterCastingDataset>({
        identity,
        id: FASTER,
        gemId,
        levels: fasterLevels,
        sourceRows,
      });
    return success<SelectedSkillControlledDestructionDataset>({
      identity,
      id: SUPPORT,
      gemId,
      levels,
      sourceRows,
    });
  } catch (error) {
    return failure(
      errorDiagnostic(
        'support.invalid-data',
        error instanceof Error ? error.message : 'Invalid support data.',
      ),
    );
  }
}

export async function loadControlledDestructionDataset(
  reader: CatalogReader,
): Promise<Result<SelectedSkillControlledDestructionDataset>> {
  const loaded = await loadReviewedSupportDataset(reader, SUPPORT);
  if (!loaded.ok) return loaded;
  return loaded.value.id === SUPPORT
    ? success(loaded.value)
    : failure(
        errorDiagnostic('support.invalid-data', 'Mismatched Controlled Destruction profile.'),
      );
}

export async function loadFasterCastingDataset(
  reader: CatalogReader,
): Promise<Result<SelectedSkillFasterCastingDataset>> {
  const loaded = await loadReviewedSupportDataset(reader, FASTER);
  if (!loaded.ok) return loaded;
  return loaded.value.id === FASTER
    ? success(loaded.value)
    : failure(errorDiagnostic('support.invalid-data', 'Mismatched Faster Casting profile.'));
}

/** Interpret explicit support facts. Crit and resource effects stay visible outside the hit metric. */
export function calculateSelectedSkillSupports(
  input: SelectedSkillInput,
  dataset: SparkDataset,
): Result<SelectedSkillSupportTrace> {
  const supports = (input.skill.supports ?? []).map((support) => ({
    ...support,
    source: { ...support.source },
  }));
  let spellDamageMultiplier = 1;
  let criticalChanceMultiplier = 1;
  let manaCostMultiplier = 1;
  let increasedCastSpeedPercent = 0;
  const sourceRows: SourceRowRef[] = [];
  const contributions: SelectedSkillSupportContribution[] = [];
  for (const support of supports) {
    const data = dataset.supports?.find((candidate) => candidate.id === support.id);
    if (!data || !sameSnapshot(input.identity, data.identity))
      return failure(
        errorDiagnostic(
          'support.missing-data',
          'Selected support requires matching normalized facts from the exact snapshot.',
        ),
      );
    if (data.id === SUPPORT) {
      const level = data.levels.find((candidate) => candidate.gemLevel === support.gemLevel);
      if (!level)
        return failure(
          errorDiagnostic('support.missing-data', 'Missing selected Controlled Destruction level.'),
        );
      const rows = [...data.sourceRows, ...level.sourceRows].map((row) => ({ ...row }));
      sourceRows.push(...rows);
      if (support.enabled) {
        spellDamageMultiplier *= 1 + level.moreSpellDamagePercent / 100;
        criticalChanceMultiplier *= (100 + level.criticalStrikeChancePercent) / 100;
        manaCostMultiplier *= level.manaCostMultiplier;
      }
      contributions.push(
        {
          statId: MORE,
          value: level.moreSpellDamagePercent,
          source: { ...support.source },
          scope: 'global',
          operation: 'more-spell-damage',
          appliedToSelectedHit: support.enabled,
          appliedToCastRate: false,
          sourceRows: rows.map((row) => ({ ...row })),
        },
        {
          statId: CRIT,
          value: level.criticalStrikeChancePercent,
          source: { ...support.source },
          scope: 'global',
          operation: 'less-critical-strike-chance',
          appliedToSelectedHit: false,
          appliedToCastRate: false,
          sourceRows: rows.map((row) => ({ ...row })),
        },
      );
    } else {
      const level = data.levels.find((candidate) => candidate.gemLevel === support.gemLevel);
      if (!level)
        return failure(
          errorDiagnostic('support.missing-data', 'Missing selected Faster Casting level.'),
        );
      const rows = [...data.sourceRows, ...level.sourceRows].map((row) => ({ ...row }));
      sourceRows.push(...rows);
      if (support.enabled) {
        increasedCastSpeedPercent += level.increasedCastSpeedPercent;
        manaCostMultiplier *= level.manaCostMultiplier;
      }
      contributions.push({
        statId: CAST_SPEED,
        value: level.increasedCastSpeedPercent,
        source: { ...support.source },
        scope: 'global',
        operation: 'increased-cast-speed',
        appliedToSelectedHit: false,
        appliedToCastRate: support.enabled,
        sourceRows: rows.map((row) => ({ ...row })),
      });
    }
  }
  return success({
    supports,
    spellDamageMultiplier,
    criticalChanceMultiplier,
    increasedCastSpeedPercent,
    castTimeMultiplier: 1,
    manaCostMultiplier,
    sourceRows,
    contributions,
  });
}
