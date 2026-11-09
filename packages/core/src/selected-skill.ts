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

export const SELECTED_SPARK_CRITICAL_MODIFIER_STAT_IDS = [
  'critical_strike_chance_+%',
  'spell_critical_strike_chance_+%',
  'base_critical_strike_multiplier_+',
] as const;

export const SELECTED_SPARK_LIGHTNING_PENETRATION_STAT_ID =
  'base_reduce_enemy_lightning_resistance_%' as const;
export const SELECTED_SPARK_LIGHTNING_EXPOSURE_STAT_ID =
  'lightning_exposure_on_hit_magnitude' as const;
export const SELECTED_SPARK_SHOCK_STAT_ID = 'base_damage_taken_+%_from_shock' as const;

/** Supplied enemy state, independent of hit generation; percentages are bounded integers. */
export interface SelectedShockConfiguration {
  readonly magnitudePercent: number;
  readonly uptimePercent: number;
  readonly source: SourceRef;
}

export interface SelectedSkillShockDataset {
  readonly identity: SnapshotIdentity;
  readonly ruleSource: SourceRef;
  readonly sourceRows: readonly SourceRowRef[];
}

/** Scenario contribution in the exact game vocabulary, not a parsed item modifier. */
export interface SelectedSkillShockContribution extends StatContribution {
  readonly statId: typeof SELECTED_SPARK_SHOCK_STAT_ID;
  readonly uptimePercent: number;
  readonly operation: 'increased-damage-taken';
}

export interface SelectedSkillShockTrace {
  readonly mode: 'excluded' | 'configured';
  readonly magnitudePercent: number;
  readonly uptimePercent: number;
  readonly shockedDamageMultiplier: number;
  readonly averageDamageMultiplier: number;
  readonly unshockedHitMeanAfterResistance: number;
  readonly shockedHitMeanAfterResistance: number;
  readonly normalHitMeanAfterShock: number;
  readonly criticalHitMeanAfterShock: number;
  readonly expectedHitMeanAfterShock: number;
  readonly contributions: readonly SelectedSkillShockContribution[];
  readonly ruleSource: SourceRef;
  readonly sourceRows: readonly SourceRowRef[];
}

/** Explicit already-active enemy state; no application chance, first-hit or uptime inference. */
export interface SelectedLightningExposure {
  readonly statId: typeof SELECTED_SPARK_LIGHTNING_EXPOSURE_STAT_ID;
  readonly value: number;
  readonly enabled: boolean;
  readonly source: SourceRef;
}

export interface SelectedLightningResistanceConfiguration {
  readonly baseResistancePercent: number;
  readonly maximumResistanceMode: 'configured' | 'default75';
  readonly source: SourceRef;
  readonly exposures: readonly SelectedLightningExposure[];
  readonly conductivity?: SelectedConductivityConfiguration;
}

/** One already-active normal curse; no application, casting or uptime inference. */
export interface SelectedConductivityConfiguration {
  readonly id: 'Conductivity';
  readonly gemLevel: number;
  readonly quality: 0;
  readonly enabled: boolean;
  readonly increasedEffectPercent: number;
  readonly source: SourceRef;
  readonly effectSource: SourceRef;
}

export interface SelectedConductivityLevel {
  readonly gemLevel: number;
  readonly baseLightningResistancePercent: number;
  readonly durationMilliseconds: number;
  readonly radiusIncrement: number;
  readonly sourceRows: readonly SourceRowRef[];
}

export interface SelectedConductivityDataset {
  readonly identity: SnapshotIdentity;
  readonly id: 'Conductivity';
  readonly gemId: string;
  readonly chanceToBeShockedPercent: 25;
  readonly levels: readonly SelectedConductivityLevel[];
  readonly ruleSource: SourceRef;
  readonly sourceRows: readonly SourceRowRef[];
}

export interface SelectedConductivityTrace {
  readonly configuration: SelectedConductivityConfiguration;
  readonly baseLightningResistancePercent: number;
  readonly effectMultiplier: number;
  readonly scaledLightningResistancePercent: number;
  readonly roundedLightningResistancePercent: number;
  readonly truncatedLightningResistancePercent: number;
  readonly appliedLightningResistancePercent: number;
  readonly resistanceContribution: StatContribution;
  readonly effectContribution: StatContribution;
  readonly excludedShockChance: {
    readonly statId: 'chance_to_be_shocked_%';
    readonly basePercent: 25;
    readonly scaledPercent: number;
    readonly appliedToSelectedHit: false;
    readonly source: SourceRef;
  };
  readonly durationMilliseconds: number;
  readonly radiusIncrement: number;
  readonly ruleSource: SourceRef;
  readonly sourceRows: readonly SourceRowRef[];
}

export interface SelectedSkillResistanceDataset {
  readonly identity: SnapshotIdentity;
  readonly ruleSource: SourceRef;
  readonly sourceRows: readonly SourceRowRef[];
}

export interface SelectedSkillResistanceTrace {
  readonly profile: 'effective' | 'configured';
  readonly baseResistancePercent: number;
  readonly maximumResistanceMode: 'already-effective' | 'configured' | 'default75';
  readonly maximumResistancePercent: number | null;
  readonly minimumResistancePercent: number | null;
  readonly exposurePercent: number;
  readonly conductivity: SelectedConductivityTrace | null;
  readonly exposureContributions: readonly SelectedLightningExposure[];
  readonly selectedExposureIndices: readonly number[];
  readonly uncappedResistancePercent: number;
  readonly cappedResistancePercent: number;
  readonly penetrationPercent: number;
  readonly effectiveResistancePercent: number;
  readonly damageMultiplier: number;
  readonly penetrationContributions: readonly StatContribution[];
  readonly configurationSource: SourceRef;
  readonly ruleSource: SourceRef;
  readonly sourceRows: readonly SourceRowRef[];
}

export interface SelectedSkillCriticalDataset {
  readonly identity: SnapshotIdentity;
  /** Explicit pinned PoE1 player rule, not an invented client constant row. */
  readonly baseMultiplierPercent: 150;
  readonly baseMultiplierSource: SourceRef;
  readonly sourceRows: readonly SourceRowRef[];
}

export interface SelectedSkillCriticalTrace {
  readonly mode: 'disabled' | 'average';
  readonly baseChancePercent: number;
  readonly increasedChancePercent: number;
  readonly lessChanceMultiplier: number;
  readonly unroundedChancePercent: number;
  readonly roundedChancePercent: number;
  readonly chancePercent: number;
  readonly baseMultiplierPercent: number;
  readonly addedMultiplierPercent: number;
  readonly criticalMultiplier: number;
  readonly criticalHitBeforeResistance: DamageRange;
  readonly criticalHitAfterResistance: DamageRange;
  readonly expectedHitMeanBeforeResistance: number;
  readonly expectedHitMeanAfterResistance: number;
  readonly modifierContributions: readonly StatContribution[];
  readonly sourceRows: readonly SourceRowRef[];
  readonly baseMultiplierSource: SourceRef;
}

export const CONTROLLED_DESTRUCTION_STAT_IDS = [
  'support_controlled_destruction_spell_damage_+%_final',
  'support_controlled_destruction_critical_strike_chance_+%_final',
] as const;
export const FASTER_CASTING_STAT_ID = 'base_cast_speed_+%' as const;

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

export interface SelectedSkillControlledDestructionDataset {
  readonly identity: SnapshotIdentity;
  readonly id: 'SupportControlledDestruction';
  readonly gemId: string;
  readonly levels: readonly SelectedSkillSupportLevel[];
  readonly sourceRows: readonly SourceRowRef[];
}

export interface SelectedSkillFasterCastingLevel {
  readonly gemLevel: number;
  readonly increasedCastSpeedPercent: number;
  readonly manaCostMultiplier: number;
  readonly sourceRows: readonly SourceRowRef[];
}

export interface SelectedSkillFasterCastingDataset {
  readonly identity: SnapshotIdentity;
  readonly id: 'SupportFasterCasting';
  readonly gemId: string;
  readonly levels: readonly SelectedSkillFasterCastingLevel[];
  readonly sourceRows: readonly SourceRowRef[];
}

/** Two reviewed normal supports, not an extensible rule loader. */
export type SelectedSkillSupportDataset =
  SelectedSkillControlledDestructionDataset | SelectedSkillFasterCastingDataset;

export interface SelectedSkillSupportContribution extends StatContribution {
  readonly operation: 'more-spell-damage' | 'less-critical-strike-chance' | 'increased-cast-speed';
  readonly appliedToSelectedHit: boolean;
  readonly appliedToCastRate: boolean;
  readonly sourceRows: readonly SourceRowRef[];
}

export interface SelectedSkillSupportTrace {
  readonly supports: readonly SelectedSkillSupport[];
  readonly spellDamageMultiplier: number;
  readonly criticalChanceMultiplier: number;
  readonly increasedCastSpeedPercent: number;
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
  readonly effectiveLightningResistancePercent?: number;
  /** Mutually exclusive with already-effective resistance; validated at runtime. */
  readonly lightningResistance?: SelectedLightningResistanceConfiguration;
  /** Absent retains the earlier explicitly noncritical profile. */
  readonly criticalStrikeMode?: 'disabled' | 'average';
  readonly ailmentMode?: 'excluded' | 'configured-shock';
  readonly shock?: SelectedShockConfiguration;
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
  readonly engineRevision: 'poe1-selected-spark-v8';
  readonly metric: 'selected-skill-hit-combined-dps';
  readonly hit: SparkCalculation;
  readonly addedLightningDamage: AddedLightningDamageTrace;
  readonly supportEffects: SelectedSkillSupportTrace;
  readonly criticalEffects: SelectedSkillCriticalTrace;
  readonly resistanceEffects: SelectedSkillResistanceTrace;
  readonly shockEffects: SelectedSkillShockTrace;
  readonly hitsPerCast: 1;
  readonly hitsPerSecond: number;
  readonly hitDps: number;
  readonly combinedDps: number;
  readonly includedDamage: readonly ['lightning-hit'];
}
