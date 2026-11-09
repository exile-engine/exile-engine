/** Lossless, executable-code-free StatDescriptions source model shared by catalogs and adapters. */
export type SdRange =
  | { kind: 'any' }
  | { kind: 'exact'; value: number }
  | { kind: 'not'; value: number }
  | { kind: 'unsupported'; raw: string }
  | { kind: 'range'; min?: number; max?: number };

export interface SdTransform {
  name: string;
  args: string[];
}

export interface SdVariant {
  ranges: SdRange[];
  flags?: string[];
  rawLine?: string;
  text: string;
  transforms: SdTransform[];
  sourceLine: number;
}

export interface SdRule {
  id: string;
  groupId: string;
  sourcePath: string;
  scope: string;
  descriptionName?: string;
  declarationKind?: 'description' | 'handed_description';
  hand?: 'main' | 'off';
  statIds: string[];
  locale: string;
  variants: SdVariant[];
}
