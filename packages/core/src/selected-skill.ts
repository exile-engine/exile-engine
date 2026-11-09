import type {
  DamageRange,
  SnapshotIdentity,
  SourceRef,
  SparkCalculation,
  SourceRowRef,
  StatContribution,
} from './types.js';

export const SPARK_ADDED_LIGHTNING_STAT_IDS = [
  'spell_minimum_added_lightning_damage',
  'spell_maximum_added_lightning_damage',
] as const;

export const CONTROLLED_DESTRUCTION_STAT_IDS = [
  'support_controlled_destruction_spell_damage_+%_final',
  'support_controlled_destruction_critical_strike_chance_+%_final',
] as const;

export interface SelectedSkillSupport {
  readonly id: string;
  readonly gemLevel: number;
  readonly quality: number;
  readonly enabled: boolean;
  readonly source: SourceRef;
}

export interface SelectedSkillSupportLevel {
  readonly gemLevel: number;
  readonly moreSpellDamagePercent: number;
  readonly criticalStrikeChancePercent: number;
  readonly manaCostMultiplier: number;
  readonly sourceRows: readonly SourceRowRef[];
}

/** Only the reviewed normal Controlled Destruction slice, not an extensible rule loader. */
export interface SelectedSkillSupportDataset {
  readonly identity: SnapshotIdentity;
  readonly id: 'SupportControlledDestruction';
  readonly gemId: string;
  readonly levels: readonly SelectedSkillSupportLevel[];
  readonly sourceRows: readonly SourceRowRef[];
}

export interface SelectedSkillSupportContribution extends StatContribution {
  readonly operation: 'more-spell-damage' | 'less-critical-strike-chance';
  readonly appliedToSelectedHit: boolean;
  readonly sourceRows: readonly SourceRowRef[];
}

export interface SelectedSkillSupportTrace {
  readonly supports: readonly SelectedSkillSupport[];
  readonly spellDamageMultiplier: number;
  readonly criticalChanceMultiplier: number;
  readonly castTimeMultiplier: 1;
  /** Multiplier only: resource costs and sustainable casting are not calculated. */
  readonly manaCostMultiplier: number;
  readonly contributions: readonly SelectedSkillSupportContribution[];
  readonly sourceRows: readonly SourceRowRef[];
}

/** One ordered authored range, never two unrelated endpoint occurrences. */
export interface AddedLightningDamageContribution {
  readonly statIds: typeof SPARK_ADDED_LIGHTNING_STAT_IDS;
  readonly values: readonly [number, number];
  readonly source: SourceRef;
  readonly scope?: 'global';
  readonly conditions?: readonly string[];
}

export interface AddedLightningDamageTrace {
  readonly raw: DamageRange;
  readonly effectiveness: number;
  readonly effective: DamageRange;
  readonly combinedBase: DamageRange;
  readonly contributions: readonly AddedLightningDamageContribution[];
}

/** Explicit host identity: no enemy defaults or saved PoB output are inferred. */
export interface SelectedSkillConfiguration {
  readonly id: string;
  readonly effectiveLightningResistancePercent: number;
}

export interface SelectedSkillSelection {
  readonly id: string;
  readonly gemLevel: number;
  readonly quality: number;
  readonly variant?: 'normal';
  readonly statSet?: 'base';
  readonly supports?: readonly SelectedSkillSupport[];
}

/** Small selected-skill slice, not a complete character or Full DPS input. */
export interface SelectedSkillInput {
  readonly identity: SnapshotIdentity;
  readonly buildId: string;
  readonly skill: SelectedSkillSelection;
  readonly configuration: SelectedSkillConfiguration;
  readonly modifiers: readonly StatContribution[];
  readonly addedLightningDamage?: readonly AddedLightningDamageContribution[];
}

export interface SelectedSkillCalculation {
  readonly identity: SnapshotIdentity;
  readonly buildId: string;
  readonly configuration: SelectedSkillConfiguration;
  readonly skill: SelectedSkillSelection;
  readonly engineRevision: 'poe1-selected-spark-v3';
  readonly metric: 'selected-skill-hit-combined-dps';
  readonly hit: SparkCalculation;
  readonly addedLightningDamage: AddedLightningDamageTrace;
  readonly supportEffects: SelectedSkillSupportTrace;
  readonly hitsPerCast: 1;
  readonly hitsPerSecond: number;
  readonly hitDps: number;
  readonly combinedDps: number;
  readonly includedDamage: readonly ['lightning-hit'];
}
