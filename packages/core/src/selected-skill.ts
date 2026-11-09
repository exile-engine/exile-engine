import type {
  DamageRange,
  SnapshotIdentity,
  SourceRef,
  SparkCalculation,
  StatContribution,
} from './types.js';

export const SPARK_ADDED_LIGHTNING_STAT_IDS = [
  'spell_minimum_added_lightning_damage',
  'spell_maximum_added_lightning_damage',
] as const;

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
  readonly supports?: readonly string[];
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
  readonly engineRevision: 'poe1-selected-spark-v2';
  readonly metric: 'selected-skill-hit-combined-dps';
  readonly hit: SparkCalculation;
  readonly addedLightningDamage: AddedLightningDamageTrace;
  readonly hitsPerCast: 1;
  readonly hitsPerSecond: number;
  readonly hitDps: number;
  readonly combinedDps: number;
  readonly includedDamage: readonly ['lightning-hit'];
}
