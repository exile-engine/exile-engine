/** Game identities remain separate even when game stat IDs match. */
export type GameId = 'poe1' | 'poe2';

/** Package semver is not a game-data version. */
export interface SnapshotIdentity {
  readonly game: GameId;
  readonly build: string;
  readonly snapshotId: string;
}

export interface SourceRef {
  readonly kind: 'item' | 'skill' | 'quality' | 'scenario' | 'external';
  readonly id: string;
  readonly label?: string;
  readonly line?: number;
}

/** Preserve each occurrence and its provenance, including repeated stat IDs. */
export interface StatContribution {
  readonly statId: string;
  readonly value: number;
  readonly source: SourceRef;
  readonly scope?: 'global' | 'local';
  readonly conditions?: readonly string[];
}

export interface Diagnostic {
  readonly code: string;
  readonly severity: 'warning' | 'error';
  readonly message: string;
  readonly source?: SourceRef;
}

export type Result<T> =
  | { readonly ok: true; readonly value: T; readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

export interface CatalogRecord {
  readonly key: string;
  readonly rowIndex: number;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface CatalogRef {
  readonly kind: 'ref';
  readonly table: string;
  readonly key: string;
  readonly rowIndex: number;
}

/** An excluded foreign key cannot be resolved by inventing a source row. */
export interface SourceCatalogRef {
  readonly kind: 'source-ref';
  readonly table: string;
  readonly rowIndex: number;
  readonly sourceColumn?: string;
}

/** The host supplies I/O; calculation runtime contains no filesystem or network. */
export interface CatalogReader {
  readonly identity: SnapshotIdentity;
  getTable(name: string): Promise<readonly CatalogRecord[]>;
  getRecord(table: string, key: string): Promise<CatalogRecord | undefined>;
  resolve(ref: CatalogRef): Promise<CatalogRecord | undefined>;
}

export const SPARK_MODIFIER_STAT_IDS = [
  'damage_+%',
  'spell_damage_+%',
  'lightning_damage_+%',
  'projectile_damage_+%',
  'base_cast_speed_+%',
] as const;
export type SparkModifierStatId = (typeof SPARK_MODIFIER_STAT_IDS)[number];

/** An explicit single-hit scenario rather than a complete character build. */
export interface SparkInput {
  readonly identity: SnapshotIdentity;
  readonly gemLevel: number;
  readonly quality?: number;
  readonly variant?: 'normal';
  readonly statSet?: 'base';
  readonly modifiers?: readonly StatContribution[];
  readonly supports?: readonly string[];
  /** Already effective: resistance caps, exposure and penetration are not inferred. */
  readonly effectiveLightningResistancePercent: number;
}

export interface SourceRowRef {
  readonly table: string;
  readonly key: string;
  readonly rowIndex: number;
}

export interface SparkLevel {
  readonly gemLevel: number;
  readonly baseLightningMin: number;
  readonly baseLightningMax: number;
  /** PoE1 client DamageEffectiveness / 10000 + 1; absent for the PoE2 slice. */
  readonly addedDamageEffectiveness?: number;
  /** PoE1 source SpellCritChance / 100, in percentage points. */
  readonly baseCriticalStrikeChancePercent?: number;
  readonly sourceRows: readonly SourceRowRef[];
}

export interface SparkQualityStat {
  readonly statId: string;
  readonly valuePerQuality: number;
  readonly sourceRows: readonly SourceRowRef[];
}

/** Validated normalized data loaded before the synchronous calculation. */
export interface SparkDataset {
  readonly identity: SnapshotIdentity;
  readonly baseDamageAuthority: 'client-resolved';
  readonly grantedEffectId: string;
  readonly statSetId: string;
  readonly baseCastTimeSeconds: number;
  readonly supportedModifierStatIds: readonly SparkModifierStatId[];
  readonly levels: readonly SparkLevel[];
  readonly qualityStats: readonly SparkQualityStat[];
  readonly sourceRows: readonly SourceRowRef[];
  readonly ruleProvenance: readonly string[];
  /** Optional PoE1 selected-skill facts, loaded by the PoE1 host-facing normalizer. */
  readonly supports?: readonly import('./selected-skill.js').SelectedSkillSupportDataset[];
  readonly critical?: import('./selected-skill.js').SelectedSkillCriticalDataset;
  readonly resistance?: import('./selected-skill.js').SelectedSkillResistanceDataset;
  readonly shock?: import('./selected-skill.js').SelectedSkillShockDataset;
  readonly conductivity?: import('./selected-skill.js').SelectedConductivityDataset;
}

export interface DamageRange {
  readonly min: number;
  readonly max: number;
  readonly mean: number;
}

export interface SparkCalculation {
  readonly identity: SnapshotIdentity;
  readonly skillId: string;
  readonly gemLevel: number;
  readonly quality: number;
  readonly mode: 'normal-base-noncritical-single-hit';
  readonly baseLightningDamage: DamageRange;
  readonly nonCriticalHitBeforeResistance: DamageRange;
  readonly nonCriticalHitAfterResistance: DamageRange;
  readonly baseCastTimeSeconds: number;
  readonly castTimeSeconds: number;
  readonly castsPerSecond: number;
  readonly effectiveLightningResistancePercent: number;
  readonly increasedDamagePercent: number;
  readonly increasedCastSpeedPercent: number;
  readonly qualityStats: readonly StatContribution[];
  readonly modifierContributions: readonly StatContribution[];
  readonly sourceRows: readonly SourceRowRef[];
  readonly ruleProvenance: readonly string[];
}
