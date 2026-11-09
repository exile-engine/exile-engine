import type { Diagnostic, SnapshotIdentity, StatContribution } from '@exile-engine/core';

/** Public compatibility contract only. No XML, URL, base64, zlib or Lua runtime is bundled. */
export const pobCompatibility = Object.freeze({
  status: 'contracts-only' as const,
  xmlImportImplemented: false as const,
  shareCodeImportImplemented: false as const,
  supportedGames: [] as readonly string[],
});

export interface PobXmlSource {
  format: 'pob-xml';
  xml: string;
  target: SnapshotIdentity;
}

export interface PobSourceLocation {
  element: string;
  attribute?: string;
  itemId?: string;
  textLine?: number;
}

export interface PobUnresolvedInput {
  source: PobSourceLocation;
  raw: string;
  reason:
    | 'unknown-stat'
    | 'ambiguous-stat'
    | 'unsupported-mechanic'
    | 'unknown-game-version'
    | 'malformed-input';
  candidateStatIds?: readonly string[];
}

export interface PobImportedSkill {
  gameSkillId: string;
  level: number;
  quality: number;
  enabled: boolean;
  source: PobSourceLocation;
}

/** A future importer must retain unresolved input and the exact target snapshot. */
export interface PobImportedBuild {
  identity: SnapshotIdentity;
  adapterVersion: string;
  modifiers: readonly StatContribution[];
  skills: readonly PobImportedSkill[];
  unresolved: readonly PobUnresolvedInput[];
  diagnostics: readonly Diagnostic[];
  complete: boolean;
}

/** Implementations must parse XML as data with external entities/network access disabled. */
export interface PobXmlAdapter {
  readonly adapterVersion: string;
  importXml(source: PobXmlSource): PobImportedBuild | Promise<PobImportedBuild>;
}
