import type {
  SnapshotIdentity,
  StatContribution,
  SourceRef,
  SdRange,
  SdTransform,
  SdVariant,
  SdRule,
} from '@exile-engine/core';
export type { SdRange, SdTransform, SdVariant, SdRule } from '@exile-engine/core';
export interface ParserDiagnostic {
  code: string;
  severity: 'warning' | 'error';
  message: string;
  line: number;
}
export interface SdParseResult {
  format: 'exile-sd-v1';
  sourcePath: string;
  rules: SdRule[];
  includes: string[];
  noDescriptionStatIds: string[];
  unparsedLines: { line: number; text: string }[];
  directives: { name: string; args: string[]; line: number }[];
  diagnostics: ParserDiagnostic[];
}
export interface SdParseOptions {
  sourcePath?: string;
  locale?: string;
  maxLines?: number;
  maxRules?: number;
  maxLineLength?: number;
}

const localeNames: Record<string, string> = {
  English: 'en',
  Thai: 'th',
  German: 'de',
  Spanish: 'es',
  French: 'fr',
  Portuguese: 'pt',
  Russian: 'ru',
  Korean: 'ko',
  Japanese: 'ja',
  Turkish: 'tr',
  'Traditional Chinese': 'zh-TW',
  'Simplified Chinese': 'zh-CN',
  'Spanish (Latin America)': 'es-419',
};
export function normalizeLocale(locale: string): string {
  const input = locale.trim();
  const known = Object.entries(localeNames).find(
    ([name, code]) =>
      name.toLowerCase() === input.toLowerCase() || code.toLowerCase() === input.toLowerCase(),
  );
  return known?.[1] ?? input;
}

function parseRange(token: string): SdRange | undefined {
  if (token === '#') return { kind: 'any' };
  if (/^!-?\d+$/.test(token) && Number.isSafeInteger(Number(token.slice(1))))
    return { kind: 'not', value: Number(token.slice(1)) };
  if (/^-?\d+$/.test(token) && Number.isSafeInteger(Number(token)))
    return { kind: 'exact', value: Number(token) };
  const m = /^(#|-?\d+)\|(#|-?\d+)$/.exec(token);
  if (!m) return undefined;
  if (m.slice(1).some((bound) => bound !== '#' && !Number.isSafeInteger(Number(bound))))
    return undefined;
  return {
    kind: 'range',
    ...(m[1] !== '#' ? { min: Number(m[1]) } : {}),
    ...(m[2] !== '#' ? { max: Number(m[2]) } : {}),
  };
}

function parseTransforms(tail: string): SdTransform[] {
  const tokens = tail.trim().split(/\s+/).filter(Boolean);
  const result: SdTransform[] = [];
  for (const token of tokens) {
    if (
      !result.length ||
      (!/^-?\d+$/.test(token) &&
        !(result.at(-1)?.name === 'reminderstring' && !result.at(-1)?.args.length))
    )
      result.push({ name: token, args: [] });
    else result.at(-1)!.args.push(token);
  }
  return result;
}

/** Parse extracted UTF-16 SD text. Unknown transforms remain data, never executable code. */
export function parseStatDescriptions(text: string, options: SdParseOptions = {}): SdParseResult {
  const sourcePath = (options.sourcePath ?? 'unknown').replaceAll('\\', '/');
  const result: SdParseResult = {
    format: 'exile-sd-v1',
    sourcePath,
    rules: [],
    includes: [],
    noDescriptionStatIds: [],
    unparsedLines: [],
    directives: [],
    diagnostics: [],
  };
  const maxLines = options.maxLines ?? 2_000_000;
  const maxRules = options.maxRules ?? 500_000;
  const maxLineLength = options.maxLineLength ?? 200_000;
  if (text.length > maxLines * 200)
    throw new RangeError('SD text exceeds the configured work limit.');
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.length > maxLines)
    throw new RangeError('SD line count exceeds the configured work limit.');
  let index = 0,
    ordinal = 0;
  const next = (): { text: string; line: number } | undefined => {
    while (index < lines.length) {
      const value = lines[index]!.trim();
      const line = ++index;
      if (value.length > maxLineLength)
        throw new RangeError('SD line length exceeds the configured work limit.');
      if (value && !value.startsWith('//')) return { text: value, line };
    }
    return undefined;
  };
  const diagnostic = (code: string, message: string, line: number) =>
    result.diagnostics.push({
      code,
      severity: code === 'unsupported-range' ? 'warning' : 'error',
      message,
      line,
    });
  let current = next();
  while (current) {
    if (/^(?:no_identifiers|has_identifiers)$/.test(current.text)) {
      result.directives.push({ name: current.text, args: [], line: current.line });
      current = next();
      continue;
    }
    const include = /^include\s+"([^"]+)"\s*$/.exec(current.text);
    if (include) {
      result.includes.push(include[1]!);
      current = next();
      continue;
    }
    const excluded = /^no_description\s+(\S+)\s*$/.exec(current.text);
    if (excluded) {
      result.noDescriptionStatIds.push(excluded[1]!);
      current = next();
      continue;
    }
    const declaration = /^(description|handed_description)(?:\s+(\S+))?\s*$/.exec(current.text);
    if (!declaration) {
      diagnostic(
        'unknown-directive',
        'Unrecognized SD directive preserved in unparsedLines.',
        current.line,
      );
      result.unparsedLines.push({ ...current });
      current = next();
      continue;
    }
    const declarationLine = current.line;
    const statLine = next();
    const fields = statLine?.text.split(/\s+/) ?? [];
    const statCount = Number(fields[0]);
    const consumedStatLines = statLine ? [statLine] : [];
    if (Number.isSafeInteger(statCount) && statCount > 0 && statCount <= 100) {
      while (fields.length < statCount + 1) {
        const continuation = next();
        if (!continuation) break;
        consumedStatLines.push(continuation);
        fields.push(...continuation.text.split(/\s+/));
      }
    }
    if (
      !statLine ||
      !Number.isSafeInteger(statCount) ||
      statCount < 1 ||
      statCount > 100 ||
      fields.length !== statCount + 1 ||
      fields.slice(1).some((field) => /^-?\d+$/.test(field) || /["{}]/.test(field))
    ) {
      diagnostic(
        'invalid-stat-declaration',
        'Expected an exact positive count followed by that many stat IDs.',
        statLine?.line ?? declarationLine,
      );
      result.unparsedLines.push(...consumedStatLines);
      current = statLine;
      if (current && !/^(?:handed_)?description\b/.test(current.text)) current = next();
      continue;
    }
    const statIds = fields.slice(1);
    let alternateStatIds: string[] | undefined;
    if (declaration[1] === 'handed_description') {
      const alternateLine = next();
      const alternateFields = alternateLine?.text.split(/\s+/) ?? [];
      if (alternateFields.length !== statCount) {
        diagnostic(
          'invalid-handed-stat-declaration',
          'Expected one off-hand stat ID per main-hand stat ID.',
          alternateLine?.line ?? declarationLine,
        );
        result.unparsedLines.push(...consumedStatLines, ...(alternateLine ? [alternateLine] : []));
        current = next();
        continue;
      }
      alternateStatIds = alternateFields;
    }
    const groupId = sourcePath + '#' + ordinal++;
    let locale = normalizeLocale(options.locale ?? 'en');
    const localeOccurrences = new Map<string, number>();
    current = next();
    while (current) {
      const language = /^lang\s+"([^"]+)"\s*$/.exec(current.text);
      if (language) {
        locale = normalizeLocale(language[1]!);
        current = next();
      }
      if (!current || !/^\d+$/.test(current.text)) break;
      const count = Number(current.text);
      if (!Number.isSafeInteger(count) || count > maxRules)
        throw new RangeError('SD variant count exceeds the configured work limit.');
      const occurrence = (localeOccurrences.get(locale) ?? 0) + 1;
      localeOccurrences.set(locale, occurrence);
      const rule: SdRule = {
        id: groupId + ':' + locale + (occurrence > 1 ? ':section-' + occurrence : ''),
        groupId,
        sourcePath,
        scope: sourcePath.replace(/\.(?:txt|csd)$/i, ''),
        ...(declaration[2] ? { descriptionName: declaration[2] } : {}),
        declarationKind: declaration[1] as 'description' | 'handed_description',
        statIds: [...statIds],
        locale,
        variants: [],
      };
      for (let variantIndex = 0; variantIndex < count; variantIndex++) {
        const variantLine = next();
        if (!variantLine) {
          diagnostic(
            'missing-variant',
            'The language variant count exceeds available lines.',
            current.line,
          );
          break;
        }
        const variantPattern = /^(.*?)"((?:\\.|[^"\\])*)"\s*(.*)$/s;
        let match = variantPattern.exec(variantLine.text);
        // Some original client descriptions contain a literal newline inside the quoted text.
        while (!match && /^[^"]*"/.test(variantLine.text)) {
          const continuation = next();
          if (!continuation) break;
          variantLine.text += '\n' + continuation.text;
          if (variantLine.text.length > maxLineLength)
            throw new RangeError('Multiline SD variant exceeds the configured work limit.');
          match = variantPattern.exec(variantLine.text);
        }
        const prefix = match?.[1]?.trim().split(/\s+/).filter(Boolean) ?? [];
        const rangeTokens = prefix.slice(0, statCount);
        const ranges = rangeTokens.map(
          (token) => parseRange(token) ?? { kind: 'unsupported' as const, raw: token },
        );
        if (!match || ranges.length !== statCount) {
          diagnostic(
            'invalid-variant',
            'Expected one range per stat followed by quoted text.',
            variantLine.line,
          );
          result.unparsedLines.push(variantLine);
          continue;
        }
        if (ranges.some((range) => range.kind === 'unsupported'))
          diagnostic(
            'unsupported-range',
            'Unrecognized source range preserved verbatim; matching is disabled for this variant.',
            variantLine.line,
          );
        rule.variants.push({
          ranges: ranges as SdRange[],
          flags: prefix.slice(statCount),
          rawLine: variantLine.text,
          text: match[2]!.replace(/\\"/g, '"').replace(/\\n/g, '\n'),
          transforms: parseTransforms(match[3]!),
          sourceLine: variantLine.line,
        });
      }
      if (alternateStatIds) {
        result.rules.push({
          ...rule,
          id: rule.id + ':main',
          groupId: rule.groupId + ':main',
          hand: 'main',
        });
        result.rules.push({
          ...rule,
          id: rule.id + ':off',
          groupId: rule.groupId + ':off',
          statIds: [...alternateStatIds],
          hand: 'off',
        });
      } else result.rules.push(rule);
      if (result.rules.length > maxRules)
        throw new RangeError('SD rule count exceeds the configured work limit.');
      current = next();
      if (!current || !/^lang\b/.test(current.text)) break;
    }
  }
  return result;
}

export interface ItemBase {
  id: string;
  itemClassId?: string;
  names: Readonly<Record<string, string>>;
}
export interface ItemTextCatalog {
  descriptions: readonly SdRule[];
  bases?: readonly ItemBase[];
}
export interface ItemTextLimits {
  maxTextLength?: number;
  maxLines?: number;
  maxLineLength?: number;
  maxRules?: number;
  maxCandidatesPerLine?: number;
  maxMatchAttempts?: number;
  maxAttemptsPerLine?: number;
}
export interface StatValue {
  statId: string;
  value: number;
}
export interface StatCandidate {
  ruleIds: string[];
  groupId: string;
  statIds: string[];
  values: number[];
  stats: StatValue[];
  sourceLine: number;
  sourceText: string;
  supported: boolean;
}
export interface ParsedStatGroup {
  status: 'matched' | 'ambiguous' | 'unmatched';
  sourceLine: number;
  sourceText: string;
  candidates: StatCandidate[];
  selected?: StatCandidate;
}
export interface ParsedItemLine {
  number: number;
  text: string;
  kind: 'blank' | 'separator' | 'identity' | 'property' | 'modifier';
  group?: ParsedStatGroup;
}
export interface ParsedItemText {
  identity: SnapshotIdentity;
  locale: string;
  itemClass?: string;
  rarity?: string;
  nameLines: string[];
  baseCandidates: ItemBase[];
  lines: ParsedItemLine[];
  groups: ParsedStatGroup[];
  modifiers: StatContribution[];
  complete: boolean;
  diagnostics: ParserDiagnostic[];
}
export interface ParseItemOptions {
  identity: SnapshotIdentity;
  locale?: string;
  supportedStatIds?: readonly string[];
  limits?: ItemTextLimits;
}
export interface RenderResult {
  ok: boolean;
  text?: string;
  reason?: string;
  ruleId?: string;
}

/** The explicitly implemented Spark wand slice; other mechanics remain visible as unsupported. */
export const sparkWandStatIds = Object.freeze([
  'spell_damage_+%',
  'lightning_damage_+%',
  'projectile_damage_+%',
  'damage_+%',
  'base_cast_speed_+%',
]);

function plainText(text: string): string {
  return text
    .replace(/\[([^\[\]]+)\]/g, (_match, body: string) =>
      body.includes('|') ? body.slice(body.indexOf('|') + 1) : body,
    )
    .replace(/\r/g, '')
    .normalize('NFC');
}
function numericText(text: string): string {
  return text.replace(/[๐-๙]/g, (char) => String(char.charCodeAt(0) - 0x0e50));
}
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function matchesRange(value: number, range: SdRange): boolean {
  if (!Number.isFinite(value)) return false;
  if (range.kind === 'any') return true;
  if (range.kind === 'exact') return value === range.value;
  if (range.kind === 'not') return value !== range.value;
  if (range.kind === 'unsupported') return false;
  return (
    (range.min === undefined || value >= range.min) &&
    (range.max === undefined || value <= range.max)
  );
}

interface NumericTransform {
  factor: number;
  offset: number;
  decimals?: number;
  rounding?: 'round' | 'truncate' | 'negated-round';
}
function numericTransform(variant: SdVariant, statIndex: number): NumericTransform | undefined {
  let factor = 1,
    offset = 0,
    decimals: number | undefined,
    rounding: NumericTransform['rounding'];
  for (const transform of variant.transforms) {
    if (['canonical_line', 'canonical_stat', 'reminderstring', 'markup'].includes(transform.name))
      continue;
    const targetIndex = Number(transform.args[0]);
    if (
      transform.args.length !== 1 ||
      !Number.isInteger(targetIndex) ||
      targetIndex < 1 ||
      targetIndex > variant.ranges.length
    )
      return undefined;
    const name = transform.name;
    let multiplier: number | undefined;
    let add = 0;
    if (name === 'negate') multiplier = -1;
    else if (name === 'double') multiplier = 2;
    else if (name === 'negate_and_double') multiplier = -2;
    else if (name === 'multiplicative_damage_modifier') {
      multiplier = 1;
      add = 100;
    } else if (name === 'divide_by_one_hundred_and_negate') multiplier = -0.01;
    else if (name === 'multiply_by_one_hundred') multiplier = 100;
    else if (name === 'multiply_by_ten') multiplier = 10;
    else if (name === 'multiply_by_four') multiplier = 4;
    else if (name === 'times_twenty') multiplier = 20;
    else if (name === 'times_one_point_five') multiplier = 1.5;
    else if (name === 'plus_two_hundred') {
      multiplier = 1;
      add = 200;
    } else if (name === 'invert_chance') {
      multiplier = -1;
      add = 100;
    } else if (/^milliseconds_to_seconds(?:_\ddp(?:_if_required)?)?$/.test(name))
      multiplier = 0.001;
    else if (/^per_minute_to_per_second(?:_\ddp(?:_if_required)?)?$/.test(name))
      multiplier = 1 / 60;
    else if (name === 'locations_to_metres') multiplier = 0.1;
    else if (name === 'deciseconds_to_seconds') multiplier = 0.1;
    else {
      const divisors: Record<string, number> = {
        one_thousand: 1000,
        one_hundred: 100,
        ten: 10,
        two: 2,
        three: 3,
        four: 4,
        five: 5,
        six: 6,
        twelve: 12,
        fifteen: 15,
        twenty: 20,
      };
      const divided = /^divide_by_([a-z_]+?)(?:_(\d)dp(?:_if_required)?)?$/.exec(name);
      if (divided && divisors[divided[1]!]) multiplier = 1 / divisors[divided[1]!]!;
    }
    if (multiplier === undefined) return undefined;
    if (Number(transform.args[0]) !== statIndex + 1) continue;
    // A rounded intermediate cannot be collapsed into a final affine transform safely.
    if (decimals !== undefined) return undefined;
    const precision = /_(\d)dp(?:_if_required)?$/.exec(name);
    if (precision) {
      decimals = Number(precision[1]);
      rounding = decimals === 0 ? 'truncate' : 'round';
    }
    if (name === 'per_minute_to_per_second') {
      decimals = 1;
      rounding = 'round';
    }
    if (name === 'divide_by_one_hundred_and_negate') {
      decimals = 1;
      rounding = 'negated-round';
    }
    if (name === 'times_one_point_five') {
      decimals = 0;
      rounding = 'truncate';
    }
    factor *= multiplier;
    offset = offset * multiplier + add;
    if (!Number.isFinite(factor) || factor === 0 || !Number.isFinite(offset)) return undefined;
  }
  // A transform without a numeric stat index is not a recognized numeric instruction.
  for (const transform of variant.transforms)
    if (
      !['canonical_line', 'canonical_stat', 'reminderstring', 'markup'].includes(transform.name) &&
      !/^\d+$/.test(transform.args[0] ?? '')
    )
      return undefined;
  return {
    factor,
    offset,
    ...(decimals !== undefined ? { decimals } : {}),
    ...(rounding ? { rounding } : {}),
  };
}

function checkedTransforms(variant: SdVariant): NumericTransform[] | undefined {
  if (variant.transforms.length > 128 || variant.ranges.length > 100) return undefined;
  const transforms: NumericTransform[] = [];
  for (let index = 0; index < variant.ranges.length; index++) {
    const transform = numericTransform(variant, index);
    if (!transform) return undefined;
    transforms.push(transform);
  }
  return transforms;
}

interface Placeholder {
  statIndex: number;
  format: string;
}
function compileVariant(
  variant: SdVariant,
): { regexp: RegExp; placeholders: Placeholder[] } | undefined {
  const template = plainText(variant.text);
  if (template.length > 20_000 || template.includes('\n')) return undefined;
  const placeholders: Placeholder[] = [];
  let pattern = '^',
    previous = 0;
  const token = /\{(\d+)(?::([^{}]+))?\}/g;
  for (let match = token.exec(template); match; match = token.exec(template)) {
    if (placeholders.length >= 32) return undefined;
    const literal = template.slice(previous, match.index);
    if (literal.includes('{') || literal.includes('}')) return undefined;
    // Adjacent numeric captures can require combinatorial backtracking on malformed input.
    // Real supported clipboard descriptions delimit numbers with words, spaces or punctuation.
    if (placeholders.length && !/[^0-9.+-]/.test(literal)) return undefined;
    pattern += escapeRegExp(literal).replace(/\s+/g, '\\s+');
    pattern += '([+-]?(?:[0-9]+(?:\\.[0-9]+)?|\\.[0-9]+))';
    placeholders.push({ statIndex: Number(match[1]), format: match[2] ?? '' });
    if (!/^(?:\+?d|\+?\.\d{1,2}f)?$/.test(match[2] ?? '')) return undefined;
    previous = match.index + match[0].length;
  }
  const remaining = template.slice(previous);
  if (remaining.includes('{') || remaining.includes('}')) return undefined;
  pattern += escapeRegExp(remaining).replace(/\s+/g, '\\s+') + '$';
  return { regexp: new RegExp(pattern, 'u'), placeholders };
}

function candidateFromVariant(
  text: string,
  line: number,
  rule: SdRule,
  variant: SdVariant,
  supported: ReadonlySet<string>,
): StatCandidate | undefined {
  if (variant.flags?.length) return undefined;
  const transforms = checkedTransforms(variant);
  if (!transforms) return undefined;
  const compiled = compileVariant(variant);
  const match = compiled?.regexp.exec(numericText(plainText(text.trim())));
  if (!compiled || !match) return undefined;
  const values: (number | undefined)[] = new Array(rule.statIds.length);
  for (let index = 0; index < compiled.placeholders.length; index++) {
    const placeholder = compiled.placeholders[index]!;
    if (placeholder.statIndex >= values.length) return undefined;
    const transform = transforms[placeholder.statIndex];
    // Rounded display text is not an exact inverse of an integer game stat.
    if (!transform || transform.decimals !== undefined || /\.\d+f$/.test(placeholder.format))
      return undefined;
    const value = (Number(match[index + 1]) - transform.offset) / transform.factor;
    if (
      !Number.isFinite(value) ||
      !Number.isSafeInteger(Math.round(value)) ||
      Math.abs(value - Math.round(value)) > 1e-7
    )
      return undefined;
    const integer = Math.round(value);
    const displayed = Number(match[index + 1]);
    const roundTrip = integer * transform.factor + transform.offset;
    if (
      !Number.isFinite(roundTrip) ||
      Math.abs(roundTrip - displayed) >
        8 * Number.EPSILON * Math.max(Math.abs(roundTrip), Math.abs(displayed), Number.MIN_VALUE)
    )
      return undefined;
    if (values[placeholder.statIndex] !== undefined && values[placeholder.statIndex] !== integer)
      return undefined;
    values[placeholder.statIndex] = integer;
  }
  for (let index = 0; index < values.length; index++) {
    const range = variant.ranges[index];
    if (!range) return undefined;
    if (values[index] === undefined && range.kind === 'exact') values[index] = range.value;
    if (values[index] === undefined || !matchesRange(values[index]!, range)) return undefined;
  }
  const concrete = values as number[];
  return {
    ruleIds: [rule.id],
    groupId: rule.groupId,
    statIds: [...rule.statIds],
    values: concrete,
    stats: rule.statIds.map((statId, index) => ({ statId, value: concrete[index]! })),
    sourceLine: line,
    sourceText: text,
    supported: rule.statIds.every((statId) => supported.has(statId)),
  };
}

/** Deduplicate equivalent numeric interpretations while preserving genuinely ambiguous groups. */
export function reconcileCandidates(
  candidates: readonly StatCandidate[],
  sourceText: string,
  sourceLine = 1,
): ParsedStatGroup {
  const unique = new Map<string, StatCandidate>();
  for (const candidate of candidates) {
    const key = JSON.stringify(
      candidate.stats
        .map((stat) => [stat.statId, stat.value])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    const previous = unique.get(key);
    if (previous) previous.ruleIds = [...new Set([...previous.ruleIds, ...candidate.ruleIds])];
    else unique.set(key, { ...candidate, ruleIds: [...candidate.ruleIds] });
  }
  const values = [...unique.values()];
  return {
    status: values.length === 1 ? 'matched' : values.length > 1 ? 'ambiguous' : 'unmatched',
    sourceText,
    sourceLine,
    candidates: values,
    ...(values.length === 1 ? { selected: values[0]! } : {}),
  };
}

export interface MatchStatLineOptions {
  locale?: string;
  sourceLine?: number;
  supportedStatIds?: readonly string[];
  maxCandidates?: number;
  maxAttempts?: number;
}
interface MatchBudget {
  remaining: number;
}
function matchingLimit(value: number | undefined, fallback: number): number {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 0)
    throw new RangeError('Matching work limits must be nonnegative safe integers.');
  return limit;
}

export function matchStatLine(
  text: string,
  catalog: ItemTextCatalog,
  options: MatchStatLineOptions = {},
): ParsedStatGroup {
  return matchLineWithBudget(text, catalog, options, {
    remaining: matchingLimit(options.maxAttempts, 50_000),
  });
}

function matchLineWithBudget(
  text: string,
  catalog: ItemTextCatalog,
  options: MatchStatLineOptions,
  budget: MatchBudget,
): ParsedStatGroup {
  if (text.length > 20_000) throw new RangeError('Item line exceeds the matching work limit.');
  if (catalog.descriptions.length > 100_000)
    throw new RangeError('Item catalog exceeds the matching work limit.');
  const locale = normalizeLocale(options.locale ?? 'en');
  const supported = new Set(options.supportedStatIds ?? sparkWandStatIds);
  const candidates: StatCandidate[] = [];
  const limit = options.maxCandidates ?? 1000;
  let lineAttempts = matchingLimit(options.maxAttempts, 50_000);
  const attempt = () => {
    if (budget.remaining <= 0 || lineAttempts <= 0)
      throw new RangeError('Item matching attempts exceed the configured work limit.');
    budget.remaining--;
    lineAttempts--;
  };
  const normalized = text.replace(/\s+\((?:implicit|crafted|enchant|fractured)\)\s*$/i, '');
  for (const rule of catalog.descriptions) {
    attempt();
    if (rule.locale !== locale) continue;
    if (rule.variants.length > 1000 || rule.statIds.length > 100)
      throw new RangeError('SD rule exceeds the matching work limit.');
    for (const variant of rule.variants) {
      attempt();
      const candidate = candidateFromVariant(
        normalized,
        options.sourceLine ?? 1,
        rule,
        variant,
        supported,
      );
      if (candidate) candidates.push({ ...candidate, sourceText: text });
      if (candidates.length > limit)
        throw new RangeError('Item candidates exceed the configured work limit.');
    }
  }
  return reconcileCandidates(candidates, text, options.sourceLine ?? 1);
}

/** Parse caller-supplied clipboard text; the catalog and snapshot are explicit dependencies. */
export function parseItemText(
  text: string,
  catalog: ItemTextCatalog,
  options: ParseItemOptions,
): ParsedItemText {
  const limits = options.limits ?? {};
  const budget = { remaining: matchingLimit(limits.maxMatchAttempts, 250_000) };
  if (text.length > (limits.maxTextLength ?? 200_000))
    throw new RangeError('Item text exceeds the configured work limit.');
  if (catalog.descriptions.length > (limits.maxRules ?? 100_000))
    throw new RangeError('Item catalog exceeds the configured work limit.');
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.length > (limits.maxLines ?? 1000))
    throw new RangeError('Item line count exceeds the configured work limit.');
  const result: ParsedItemText = {
    identity: { ...options.identity },
    locale: normalizeLocale(options.locale ?? 'en'),
    nameLines: [],
    baseCandidates: [],
    lines: [],
    groups: [],
    modifiers: [],
    complete: true,
    diagnostics: [],
  };
  let header = true;
  const knownProperty =
    /^(?:Wand|Staff|Sceptre|Rune Dagger|Dagger|Claw|Bow|One Handed Sword|Two Handed Sword|One Handed Axe|Two Handed Axe|One Handed Mace|Two Handed Mace|Quarterstaff|Spear|Flail|Crossbow|ไม้กายสิทธิ์)$/u;
  const propertyLabel =
    /^(?:Quality|Physical Damage|Elemental Damage|Chaos Damage|Critical Strike Chance|Attacks per Second|Weapon Range|Armour|Evasion Rating|Energy Shield|Block chance|Chance to Block|Requirements|Level|Str|Dex|Int|Sockets|Item Level|Requires|Limited to|Radius|คุณภาพ|ความเสียหาย กายภาพ|ความเสียหาย ธาตุ|ความเสียหาย เคออส|โอกาสคริติคอล|จำนวนครั้งการโจมตีต่อวินาที|ความต้องการ|เลเวล|รูเชื่อม|รู|ระดับไอเทม|เกราะ|อัตราการหลบหลีก|โล่พลังงาน):/u;
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]!;
    const value = raw.trim();
    const number = index + 1;
    if (raw.length > (limits.maxLineLength ?? 20_000))
      throw new RangeError('Item line length exceeds the configured work limit.');
    if (!value) {
      result.lines.push({ number, text: raw, kind: 'blank' });
      continue;
    }
    if (/^-{3,}$/.test(value)) {
      header = false;
      result.lines.push({ number, text: raw, kind: 'separator' });
      continue;
    }
    const itemClass = /^(?:Item Class|ประเภทไอเทม|ชนิดไอเทม):\s*(.*)$/u.exec(value);
    const rarity = /^(?:Rarity|ความหายาก):\s*(.*)$/u.exec(value);
    if (itemClass) result.itemClass = itemClass[1]!;
    if (rarity) result.rarity = rarity[1]!;
    if (header || itemClass || rarity) {
      if (!itemClass && !rarity) result.nameLines.push(value);
      result.lines.push({ number, text: raw, kind: 'identity' });
      continue;
    }
    if (
      knownProperty.test(value) ||
      propertyLabel.test(value) ||
      /^(?:Requirements|Unidentified|Corrupted|Mirrored|Split|Fractured Item|ความต้องการ|ยังไม่ได้ระบุคุณสมบัติ|มีมลทิน)(?::|$)/u.test(
        value,
      )
    ) {
      if (/^(?:Unidentified|ยังไม่ได้ระบุคุณสมบัติ)$/u.test(value)) {
        result.complete = false;
        result.diagnostics.push({
          code: 'unidentified-item',
          severity: 'error',
          message:
            'Unidentified items have hidden modifiers and cannot provide a complete calculation input.',
          line: number,
        });
      }
      result.lines.push({ number, text: raw, kind: 'property' });
      continue;
    }
    const group = matchLineWithBudget(
      value,
      catalog,
      {
        locale: result.locale,
        sourceLine: number,
        ...(options.supportedStatIds ? { supportedStatIds: options.supportedStatIds } : {}),
        ...(limits.maxCandidatesPerLine !== undefined
          ? { maxCandidates: limits.maxCandidatesPerLine }
          : {}),
        ...(limits.maxAttemptsPerLine !== undefined
          ? { maxAttempts: limits.maxAttemptsPerLine }
          : {}),
      },
      budget,
    );
    result.lines.push({ number, text: raw, kind: 'modifier', group });
    result.groups.push(group);
    if (group.selected?.supported) {
      const source: SourceRef = {
        kind: 'item',
        id: result.nameLines.join(' / ') || 'clipboard-item',
        line: number,
        label: raw,
      };
      result.modifiers.push(
        ...group.selected.stats.map((stat) => ({ ...stat, source, scope: 'global' as const })),
      );
    } else {
      result.complete = false;
      result.diagnostics.push({
        code: group.status === 'matched' ? 'unsupported-stat' : group.status + '-modifier',
        severity: 'error',
        message:
          group.status === 'matched'
            ? 'This stat is identified but outside the implemented calculation slice.'
            : 'Preserved modifier requires explicit resolution before calculation.',
        line: number,
      });
    }
  }
  result.baseCandidates = (catalog.bases ?? []).filter((base) =>
    result.nameLines.includes(base.names[result.locale] ?? ''),
  );
  if (header) {
    result.complete = false;
    result.diagnostics.push({
      code: 'missing-item-sections',
      severity: 'error',
      message: 'Expected a copied item header followed by a separator and modifier sections.',
      line: 1,
    });
  }
  if (result.baseCandidates.length !== 1) {
    result.complete = false;
    result.diagnostics.push({
      code: result.baseCandidates.length ? 'ambiguous-base' : 'unknown-base',
      severity: 'error',
      message: 'Item base identity is preserved as candidates; no base was guessed.',
      line: 1,
    });
  }
  return result;
}

/** Render a numeric group in another locale using the same real SD description group. */
export function renderStatGroup(
  group: Pick<StatCandidate, 'groupId' | 'statIds' | 'values'>,
  locale: string,
  catalog: ItemTextCatalog,
): RenderResult {
  if (
    group.statIds.length !== group.values.length ||
    group.values.length > 100 ||
    !group.values.every(Number.isSafeInteger)
  )
    return { ok: false, reason: 'Expected one exact integer value per stat ID.' };
  if (catalog.descriptions.length > 100_000)
    return { ok: false, reason: 'Description catalog exceeds the rendering work limit.' };
  const candidates = catalog.descriptions.filter(
    (rule) =>
      rule.groupId === group.groupId &&
      rule.locale === normalizeLocale(locale) &&
      JSON.stringify(rule.statIds) === JSON.stringify(group.statIds),
  );
  for (const rule of candidates)
    for (const variant of rule.variants) {
      if (variant.flags?.length) continue;
      const transforms = checkedTransforms(variant);
      if (!transforms) continue;
      if (
        !variant.ranges.every(
          (range, index) =>
            group.values[index] !== undefined && matchesRange(group.values[index]!, range),
        )
      )
        continue;
      let unsupported = false;
      const rendered = plainText(variant.text).replace(
        /\{(\d+)(?::([^{}]+))?\}/g,
        (_match, rawIndex: string, format = '') => {
          const index = Number(rawIndex);
          const transform = transforms[index];
          const raw = group.values[index];
          if (!transform || raw === undefined || !/^(?:\+?d|\+?\.\d{1,2}f)?$/.test(format)) {
            unsupported = true;
            return '';
          }
          const value = raw * transform.factor + transform.offset;
          if (!Number.isFinite(value)) {
            unsupported = true;
            return '';
          }
          const explicit = /\.(\d{1,2})f$/.exec(format);
          const precision = explicit ? Number(explicit[1]) : transform.decimals;
          const scale = precision === undefined ? 1 : 10 ** precision;
          const rounded =
            precision === undefined
              ? value
              : transform.rounding === 'truncate'
                ? Math.trunc(value)
                : transform.rounding === 'negated-round'
                  ? -Math.round(-value * scale) / scale
                  : Math.round(value * scale) / scale;
          if (!Number.isFinite(rounded)) {
            unsupported = true;
            return '';
          }
          const numeric = explicit
            ? rounded.toFixed(precision)
            : String(Number(rounded.toFixed(10)));
          return format.startsWith('+') && value >= 0 ? '+' + numeric : numeric;
        },
      );
      if (!unsupported && !/[{}]/.test(rendered))
        return { ok: true, text: rendered, ruleId: rule.id };
    }
  return { ok: false, reason: 'No supported locale variant matches this exact stat group.' };
}
