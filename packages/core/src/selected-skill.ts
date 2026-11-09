import type { SnapshotIdentity, SparkCalculation, StatContribution } from './types.js';

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
}

export interface SelectedSkillCalculation {
  readonly identity: SnapshotIdentity;
  readonly buildId: string;
  readonly configuration: SelectedSkillConfiguration;
  readonly skill: SelectedSkillSelection;
  readonly engineRevision: 'poe1-selected-spark-v1';
  readonly metric: 'selected-skill-hit-combined-dps';
  readonly hit: SparkCalculation;
  readonly hitsPerCast: 1;
  readonly hitsPerSecond: number;
  readonly hitDps: number;
  readonly combinedDps: number;
  readonly includedDamage: readonly ['lightning-hit'];
}
