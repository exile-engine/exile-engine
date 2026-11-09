import {
  errorDiagnostic,
  failure,
  isSnapshotIdentity,
  sameSnapshot,
  success,
  type CatalogReader,
  type CatalogRecord,
  type CatalogRef,
  type Result,
  type SelectedConductivityConfiguration,
  type SelectedConductivityDataset,
  type SelectedConductivityLevel,
  type SelectedConductivityTrace,
  type SelectedSkillInput,
  type SnapshotIdentity,
  type SourceRef,
  type SourceRowRef,
  type SparkDataset,
} from '@exile-engine/core';

const ID = 'Conductivity';
const GEM = 'Metadata/Items/Gems/SkillGemConductivity';
const RESISTANCE = 'base_lightning_damage_resistance_%';
const CHANCE = 'chance_to_be_shocked_%';
const EFFECT = 'curse_effect_+%';
const NO_DAMAGE = 'base_deal_no_damage';
const DURATION = 'base_skill_effect_duration';
const RADIUS = 'active_skill_base_radius_+';
const STAT_IDS = [RESISTANCE, CHANCE, EFFECT, NO_DAMAGE, DURATION, RADIUS] as const;
const ACTIVE_TYPES = [
  'Spell',
  'Area',
  'Duration',
  'Trappable',
  'Totemable',
  'Mineable',
  'Multicastable',
  'Triggerable',
  'Lightning',
  'Cascadable',
  'AppliesCurse',
  'CanRapidFire',
  'AreaSpell',
  'InstantNoRepeatWhenHeld',
  'InstantShiftAttackForLeftMouse',
  'Hex',
] as const;
const RULE_SOURCE: SourceRef = Object.freeze({
  kind: 'external',
  id: 'pob:3dbca4463c0a59079d9f7f032d8240cf868e09da:CalcPerform:2697-2713;ModStore:56-83;CalcOffence:494-506',
  label:
    'Pinned PoE1 already-active Conductivity: scale each curse stat, round to two decimals then truncate toward zero; add resistance reduction before caps and penetration.',
});
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const own = (value: Record<string, unknown>, names: readonly string[]) =>
  names.every((name) => Object.hasOwn(value, name));
const keys = (value: Record<string, unknown>, names: readonly string[]) =>
  Object.keys(value).every((name) => names.includes(name));
function dense(value: unknown, maximum: number): value is readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) return false;
  for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i)) return false;
  return true;
}
function source(value: unknown): value is SourceRef {
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
function sourceRows(value: unknown): boolean {
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
export function validConductivityConfiguration(
  value: unknown,
): value is SelectedConductivityConfiguration {
  return (
    object(value) &&
    own(value, [
      'id',
      'gemLevel',
      'quality',
      'enabled',
      'increasedEffectPercent',
      'source',
      'effectSource',
    ]) &&
    keys(value, [
      'id',
      'gemLevel',
      'quality',
      'enabled',
      'increasedEffectPercent',
      'source',
      'effectSource',
    ]) &&
    value.id === ID &&
    Number.isSafeInteger(value.gemLevel) &&
    (value.gemLevel as number) >= 1 &&
    (value.gemLevel as number) <= 20 &&
    value.quality === 0 &&
    typeof value.enabled === 'boolean' &&
    Number.isSafeInteger(value.increasedEffectPercent) &&
    (value.increasedEffectPercent as number) >= -100 &&
    (value.increasedEffectPercent as number) <= 200 &&
    source(value.source) &&
    source(value.effectSource)
  );
}
function normalized(
  data: unknown,
  identity: SnapshotIdentity,
): data is SelectedConductivityDataset {
  if (
    !object(data) ||
    !own(data, [
      'identity',
      'id',
      'gemId',
      'chanceToBeShockedPercent',
      'levels',
      'ruleSource',
      'sourceRows',
    ]) ||
    !keys(data, [
      'identity',
      'id',
      'gemId',
      'chanceToBeShockedPercent',
      'levels',
      'ruleSource',
      'sourceRows',
    ]) ||
    data.id !== ID ||
    data.gemId !== GEM ||
    data.chanceToBeShockedPercent !== 25 ||
    !object(data.identity) ||
    !own(data.identity, ['game', 'build', 'snapshotId']) ||
    !keys(data.identity, ['game', 'build', 'snapshotId']) ||
    !isSnapshotIdentity(data.identity) ||
    !sameSnapshot(data.identity, identity) ||
    !object(data.ruleSource) ||
    !own(data.ruleSource, ['kind', 'id', 'label']) ||
    !keys(data.ruleSource, ['kind', 'id', 'label']) ||
    data.ruleSource.kind !== RULE_SOURCE.kind ||
    data.ruleSource.id !== RULE_SOURCE.id ||
    data.ruleSource.label !== RULE_SOURCE.label ||
    !sourceRows(data.sourceRows) ||
    !dense(data.levels, 20) ||
    data.levels.length !== 20
  )
    return false;
  const levels = new Set<number>();
  return data.levels.every((level) => {
    if (
      !object(level) ||
      !own(level, [
        'gemLevel',
        'baseLightningResistancePercent',
        'durationMilliseconds',
        'radiusIncrement',
        'sourceRows',
      ]) ||
      !keys(level, [
        'gemLevel',
        'baseLightningResistancePercent',
        'durationMilliseconds',
        'radiusIncrement',
        'sourceRows',
      ]) ||
      !Number.isSafeInteger(level.gemLevel) ||
      (level.gemLevel as number) < 1 ||
      (level.gemLevel as number) > 20 ||
      levels.has(level.gemLevel as number) ||
      !Number.isSafeInteger(level.baseLightningResistancePercent) ||
      (level.baseLightningResistancePercent as number) < -100 ||
      (level.baseLightningResistancePercent as number) > 0 ||
      !Number.isSafeInteger(level.durationMilliseconds) ||
      (level.durationMilliseconds as number) <= 0 ||
      (level.durationMilliseconds as number) > 60_000 ||
      !Number.isSafeInteger(level.radiusIncrement) ||
      (level.radiusIncrement as number) < 0 ||
      (level.radiusIncrement as number) > 100 ||
      !sourceRows(level.sourceRows)
    )
      return false;
    levels.add(level.gemLevel as number);
    return true;
  });
}
export function selectedConductivityDatasetShape(dataset: SparkDataset): boolean {
  return (
    dataset.conductivity === undefined ||
    (Object.hasOwn(dataset, 'conductivity') && normalized(dataset.conductivity, dataset.identity))
  );
}
const rowRef = (table: string, row: CatalogRecord): SourceRowRef => ({
  table,
  key: row.key,
  rowIndex: row.rowIndex,
});
function array(row: CatalogRecord, name: string): readonly unknown[] {
  const value = row.fields[name];
  if (!dense(value, 1000)) throw new Error(`Missing bounded ${row.key}.${name}.`);
  return value;
}
function reference(value: unknown, table: string): CatalogRef {
  if (
    !object(value) ||
    !own(value, ['kind', 'table', 'key', 'rowIndex']) ||
    value.kind !== 'ref' ||
    value.table !== table ||
    typeof value.key !== 'string' ||
    !Number.isSafeInteger(value.rowIndex) ||
    (value.rowIndex as number) < 0
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

/** Read normal Q0 Conductivity facts only; its application, duration and cost are not simulated. */
export async function loadConductivityDataset(
  reader: CatalogReader,
): Promise<Result<SelectedConductivityDataset>> {
  if (!isSnapshotIdentity(reader.identity) || reader.identity.game !== 'poe1')
    return failure(errorDiagnostic('conductivity.snapshot', 'An exact PoE1 snapshot is required.'));
  const identity = { ...reader.identity };
  try {
    const effect = await reader.getRecord('GrantedEffects', ID);
    if (
      !effect ||
      effect.key !== ID ||
      effect.fields.Id !== ID ||
      effect.fields.IsSupport !== false ||
      array(effect, 'StatSet2').length
    )
      throw new Error('Missing normal Conductivity or unsupported statset variants.');
    const set = await resolve(reader, effect.fields.StatSet1, 'GrantedEffectStatSets');
    const active = await resolve(reader, effect.fields.ActiveSkill, 'ActiveSkills');
    if (
      set.key !== ID ||
      set.fields.Id !== ID ||
      active.key !== 'conductivity' ||
      active.fields.Id !== 'conductivity' ||
      active.fields.GrantedEffect !== ID
    )
      throw new Error('Mismatched normal curse identities.');
    const stats = await Promise.all(STAT_IDS.map((id) => reader.getRecord('Stats', id)));
    if (
      stats.some(
        (row, i) =>
          !row ||
          row.key !== STAT_IDS[i] ||
          row.fields.Id !== STAT_IDS[i] ||
          !Number.isSafeInteger(row.rowIndex) ||
          row.rowIndex < 0 ||
          row.fields.IsLocal !== false ||
          row.fields.IsWeaponLocal !== false,
      )
    )
      throw new Error('Missing exact Conductivity stat identities.');
    if (
      array(set, 'ImplicitStats').length !== 1 ||
      !matches(array(set, 'ImplicitStats')[0], 'Stats', stats[3]!) ||
      array(set, 'ConstantStats').length !== 1 ||
      !matches(array(set, 'ConstantStats')[0], 'Stats', stats[1]!) ||
      array(set, 'ConstantStatsValues').length !== 1 ||
      array(set, 'ConstantStatsValues')[0] !== 25 ||
      (set.fields.IgnoredStats !== undefined && array(set, 'IgnoredStats').length)
    )
      throw new Error('Unsupported curse intrinsic or constant stats.');
    const typeRefs = array(active, 'ActiveSkillTypes');
    if (
      typeRefs.length !== ACTIVE_TYPES.length ||
      !ACTIVE_TYPES.every((id) =>
        typeRefs.some((ref) => reference(ref, 'ActiveSkillType').key === id),
      )
    )
      throw new Error('Unsupported Conductivity active skill types.');
    const types = await Promise.all(
      typeRefs.map((value) => resolve(reader, value, 'ActiveSkillType')),
    );
    if (types.some((row) => row.fields.Id !== row.key))
      throw new Error('Mismatched curse skill type identity.');
    const gems = (await reader.getTable('SkillGems')).filter(
      (row) => object(row.fields.BaseItemTypesKey) && row.fields.BaseItemTypesKey.key === GEM,
    );
    if (
      gems.length !== 1 ||
      gems[0]!.fields.IsSupport !== false ||
      gems[0]!.fields.IsVaalVariant !== false
    )
      throw new Error('Missing unique normal Conductivity gem.');
    const gem = gems[0]!;
    const base = await resolve(reader, gem.fields.BaseItemTypesKey, 'BaseItemTypes');
    const variants = array(gem, 'GemVariants');
    if (base.key !== GEM || variants.length !== 1)
      throw new Error('Ambiguous Conductivity base or variant.');
    const variant = await resolve(reader, variants[0], 'GemEffects');
    if (variant.key !== ID || !matches(variant.fields.GrantedEffect, 'GrantedEffects', effect))
      throw new Error('Conductivity gem does not grant the reviewed effect.');
    const statLevels = await reader.getTable('GrantedEffectStatSetsPerLevel');
    const levels: SelectedConductivityLevel[] = [];
    for (let gemLevel = 1; gemLevel <= 20; gemLevel++) {
      const found = statLevels.filter(
        (row) =>
          matches(row.fields.StatSet, 'GrantedEffectStatSets', set) &&
          row.fields.GemLevel === gemLevel,
      );
      if (found.length !== 1) throw new Error(`Missing unique Conductivity level ${gemLevel}.`);
      const row = found[0]!;
      const ids = array(row, 'AdditionalStats');
      const values = array(row, 'AdditionalStatsValues');
      if (
        array(row, 'FloatStats').length ||
        array(row, 'BaseResolvedValues').length ||
        array(row, 'FloatStatsValues').length ||
        array(row, 'AdditionalFlags').length ||
        ids.length !== 3 ||
        values.length !== 3 ||
        ![stats[4]!, stats[5]!, stats[0]!].every((stat, index) =>
          matches(ids[index], 'Stats', stat),
        ) ||
        array(row, 'GrantedEffects').length !== 1 ||
        !matches(array(row, 'GrantedEffects')[0], 'GrantedEffects', effect)
      )
        throw new Error(`Unsupported Conductivity level ${gemLevel} stats.`);
      const duration = values[0],
        radius = values[1],
        resistance = values[2];
      if (
        !Number.isSafeInteger(duration) ||
        (duration as number) <= 0 ||
        (duration as number) > 60_000 ||
        !Number.isSafeInteger(radius) ||
        (radius as number) < 0 ||
        (radius as number) > 100 ||
        !Number.isSafeInteger(resistance) ||
        (resistance as number) < -100 ||
        (resistance as number) > 0
      )
        throw new Error(`Invalid Conductivity level ${gemLevel} values.`);
      levels.push({
        gemLevel,
        baseLightningResistancePercent: resistance as number,
        durationMilliseconds: duration as number,
        radiusIncrement: radius as number,
        sourceRows: [rowRef('GrantedEffectStatSetsPerLevel', row)],
      });
    }
    if (!sameSnapshot(identity, reader.identity))
      throw new Error('Conductivity snapshot changed while loading.');
    return success({
      identity,
      id: ID,
      gemId: GEM,
      chanceToBeShockedPercent: 25,
      levels,
      ruleSource: { ...RULE_SOURCE },
      sourceRows: [
        rowRef('GrantedEffects', effect),
        rowRef('GrantedEffectStatSets', set),
        rowRef('ActiveSkills', active),
        rowRef('SkillGems', gem),
        rowRef('BaseItemTypes', base),
        rowRef('GemEffects', variant),
        ...stats.map((row) => rowRef('Stats', row!)),
        ...types.map((row) => rowRef('ActiveSkillType', row)),
      ],
    });
  } catch (error) {
    return failure(
      errorDiagnostic(
        'conductivity.invalid-data',
        error instanceof Error ? error.message : 'Invalid Conductivity data.',
      ),
    );
  }
}

/** Round each scaled stat to two decimals before truncating toward zero, as the pinned source does. */
export function calculateSelectedConductivity(
  input: SelectedSkillInput,
  dataset?: SelectedConductivityDataset,
): Result<SelectedConductivityTrace | null> {
  const raw = input.configuration.lightningResistance;
  const configured = raw?.conductivity;
  if (configured === undefined) return success(null);
  if (!Object.hasOwn(raw!, 'conductivity') || !validConductivityConfiguration(configured))
    return failure(
      errorDiagnostic(
        'conductivity.configuration',
        'Explicit bounded normal Conductivity state and both scenario sources are required.',
      ),
    );
  if (!dataset)
    return failure(
      errorDiagnostic(
        'conductivity.missing-data',
        'Configured Conductivity requires same-snapshot normal curse facts, including when disabled.',
      ),
    );
  if (!normalized(dataset, input.identity))
    return failure(
      errorDiagnostic(
        'conductivity.invalid-data',
        'Conductivity facts must match the exact input snapshot and reviewed schema.',
      ),
    );
  const level = dataset.levels.find((value) => value.gemLevel === configured.gemLevel)!;
  const effectMultiplier = 1 + configured.increasedEffectPercent / 100;
  const scaled = level.baseLightningResistancePercent * effectMultiplier;
  const rounded = Math.floor(scaled * 100 + 0.5) / 100;
  const truncated = Math.trunc(rounded);
  const applied = configured.enabled ? truncated : 0;
  const scaledChance = Math.trunc(
    Math.floor(dataset.chanceToBeShockedPercent * effectMultiplier * 100 + 0.5) / 100,
  );
  return success({
    configuration: {
      ...configured,
      source: { ...configured.source },
      effectSource: { ...configured.effectSource },
    },
    baseLightningResistancePercent: level.baseLightningResistancePercent,
    effectMultiplier,
    scaledLightningResistancePercent: scaled,
    roundedLightningResistancePercent: rounded,
    truncatedLightningResistancePercent: truncated,
    appliedLightningResistancePercent: applied,
    resistanceContribution: {
      statId: RESISTANCE,
      value: applied,
      source: { ...configured.source },
      scope: 'global',
    },
    effectContribution: {
      statId: EFFECT,
      value: configured.increasedEffectPercent,
      source: { ...configured.effectSource },
      scope: 'global',
    },
    excludedShockChance: {
      statId: CHANCE,
      basePercent: 25,
      scaledPercent: scaledChance,
      appliedToSelectedHit: false,
      source: { ...configured.source },
    },
    durationMilliseconds: level.durationMilliseconds,
    radiusIncrement: level.radiusIncrement,
    ruleSource: { ...dataset.ruleSource },
    sourceRows: [...dataset.sourceRows, ...level.sourceRows].map((row) => ({ ...row })),
  });
}

/** Clone only the closed trace schema; no recursion through host-owned graphs. */
export function copyConductivityTrace(
  trace: SelectedConductivityTrace | null,
): SelectedConductivityTrace | null {
  if (trace === null) return null;
  return {
    ...trace,
    configuration: {
      ...trace.configuration,
      source: { ...trace.configuration.source },
      effectSource: { ...trace.configuration.effectSource },
    },
    resistanceContribution: {
      ...trace.resistanceContribution,
      source: { ...trace.resistanceContribution.source },
    },
    effectContribution: {
      ...trace.effectContribution,
      source: { ...trace.effectContribution.source },
    },
    excludedShockChance: {
      ...trace.excludedShockChance,
      source: { ...trace.excludedShockChance.source },
    },
    ruleSource: { ...trace.ruleSource },
    sourceRows: trace.sourceRows.map((row) => ({ ...row })),
  };
}
