import {
  isSnapshotIdentity,
  type AddedLightningDamageContribution,
  type Diagnostic,
  type SelectedSkillInput,
  type SnapshotIdentity,
  type StatContribution,
} from '@exile-engine/core';
import { parseXml, XmlError, type PobXmlLimits, type XmlElement } from './xml.js';

export { pobXmlLimits, type PobXmlLimits } from './xml.js';
export const pobAdapterVersion = 'poe1-spark-xml-v2';
export const pobCompatibility = Object.freeze({
  status: 'bounded-poe1-spark-xml' as const,
  xmlImportImplemented: true as const,
  shareCodeImportImplemented: false as const,
  supportedGames: ['poe1'] as readonly string[],
});

/** The host binds unversioned PoB XML to an exact reviewed snapshot. */
export interface PobXmlSource {
  readonly format: 'pob-xml';
  readonly xml: string;
  readonly target: SnapshotIdentity;
  readonly buildId: string;
  readonly configurationId: string;
}
export interface PobSourceLocation {
  readonly element: string;
  readonly attribute?: string;
  readonly itemId?: string;
  readonly textLine?: number;
}
export interface PobUnresolvedInput {
  readonly source: PobSourceLocation;
  readonly raw: string;
  readonly reason:
    | 'unknown-stat'
    | 'ambiguous-stat'
    | 'unsupported-mechanic'
    | 'unknown-game-version'
    | 'malformed-input';
  readonly candidateStatIds?: readonly string[];
}
export interface PobImportedSkill {
  readonly gameSkillId: string;
  readonly level: number;
  readonly quality: number;
  readonly enabled: boolean;
  readonly source: PobSourceLocation;
}
export interface PobImportedBuild {
  readonly identity: SnapshotIdentity | undefined;
  readonly buildId: string | undefined;
  readonly configurationId: string | undefined;
  readonly adapterVersion: string;
  readonly modifiers: readonly StatContribution[];
  readonly addedLightningDamage: readonly AddedLightningDamageContribution[];
  readonly skills: readonly PobImportedSkill[];
  readonly unresolved: readonly PobUnresolvedInput[];
  readonly diagnostics: readonly Diagnostic[];
  readonly complete: boolean;
  readonly selectedSkill?: SelectedSkillInput;
  /** Original bounded input, including unresolved fields; never evaluated. */
  readonly rawXml: string;
}
export interface PobXmlAdapter {
  readonly adapterVersion: string;
  importXml(source: PobXmlSource): PobImportedBuild | Promise<PobImportedBuild>;
}

const rules = [
  [/^([0-9]+(?:\.[0-9]+)?)% (increased|reduced) Damage$/, 'damage_+%'],
  [/^([0-9]+(?:\.[0-9]+)?)% (increased|reduced) Spell Damage$/, 'spell_damage_+%'],
  [/^([0-9]+(?:\.[0-9]+)?)% (increased|reduced) Lightning Damage$/, 'lightning_damage_+%'],
  [/^([0-9]+(?:\.[0-9]+)?)% (increased|reduced) Projectile Damage$/, 'projectile_damage_+%'],
  [/^([0-9]+(?:\.[0-9]+)?)% (increased|reduced) Cast Speed$/, 'base_cast_speed_+%'],
] as const;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 1024;
function integer(value: string | undefined, min: number, max: number): number | undefined {
  if (value === undefined || !/^[0-9]+$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : undefined;
}

/** Imports the bounded synthetic profile described in the package README. */
export function importPobXml(
  source: PobXmlSource,
  limits?: Partial<PobXmlLimits>,
): PobImportedBuild {
  const diagnostics: Diagnostic[] = [];
  const unresolved: PobUnresolvedInput[] = [];
  const modifiers: StatContribution[] = [];
  const addedLightningDamage: AddedLightningDamageContribution[] = [];
  const skills: PobImportedSkill[] = [];
  const validSource = object(source);
  const identity =
    validSource && isSnapshotIdentity(source.target) ? { ...source.target } : undefined;
  const buildId = validSource && identifier(source.buildId) ? source.buildId : undefined;
  const configurationId =
    validSource && identifier(source.configurationId) ? source.configurationId : undefined;
  const rawXml =
    validSource && typeof source.xml === 'string' && source.xml.length <= 262_144 ? source.xml : '';
  const problem = (
    code: string,
    message: string,
    location: PobSourceLocation,
    raw: string,
    reason: PobUnresolvedInput['reason'] = 'unsupported-mechanic',
  ) => {
    diagnostics.push({
      code,
      severity: 'error',
      message,
      source: { kind: 'external', id: buildId ?? 'pob-input', label: location.element },
    });
    unresolved.push({ source: location, raw, reason });
  };
  const result = (selectedSkill?: SelectedSkillInput): PobImportedBuild => ({
    identity,
    buildId,
    configurationId,
    adapterVersion: pobAdapterVersion,
    modifiers,
    addedLightningDamage,
    skills,
    unresolved,
    diagnostics,
    complete: diagnostics.length === 0 && selectedSkill !== undefined,
    ...(selectedSkill ? { selectedSkill } : {}),
    rawXml,
  });
  if (
    !validSource ||
    source.format !== 'pob-xml' ||
    typeof source.xml !== 'string' ||
    !identity ||
    identity.game !== 'poe1' ||
    !buildId ||
    !configurationId
  ) {
    problem(
      'pob.source-invalid',
      'Explicit PoE1 target snapshot, build ID, configuration ID and XML source are required.',
      { element: 'source' },
      '',
      'unknown-game-version',
    );
    return result();
  }
  for (const key of Object.keys(source))
    if (!['format', 'xml', 'target', 'buildId', 'configurationId'].includes(key))
      problem(
        'pob.source-unsupported-field',
        `Unsupported source field ${key}.`,
        { element: 'source', attribute: key },
        String((source as unknown as Record<string, unknown>)[key]),
      );
  for (const key of Object.keys(source.target))
    if (!['game', 'build', 'snapshotId'].includes(key))
      problem(
        'pob.source-unsupported-field',
        `Unsupported target identity field ${key}.`,
        { element: 'target', attribute: key },
        String((source.target as unknown as Record<string, unknown>)[key]),
      );
  let root: XmlElement;
  try {
    root = parseXml(source.xml, limits);
  } catch (error) {
    problem(
      error instanceof XmlError ? error.code : 'pob.xml-malformed',
      error instanceof Error ? error.message : 'Invalid XML input.',
      { element: 'document' },
      '',
      'malformed-input',
    );
    return result();
  }
  const check = (
    element: XmlElement,
    attributes: readonly string[],
    children: readonly string[] = [],
    text = false,
  ) => {
    for (const [name, value] of Object.entries(element.attributes))
      if (!attributes.includes(name))
        problem(
          'pob.unsupported-attribute',
          `Unsupported ${element.name} attribute ${name}.`,
          { element: element.name, attribute: name },
          value,
        );
    for (const child of element.children)
      if (!children.includes(child.name))
        problem(
          'pob.unsupported-element',
          `Unsupported ${element.name}/${child.name}.`,
          { element: child.name },
          JSON.stringify(child),
        );
    if (!text && element.text.trim())
      problem(
        'pob.unsupported-text',
        `Unexpected text in ${element.name}.`,
        { element: element.name },
        element.text,
      );
  };
  const unique = (element: XmlElement, name: string, required = true): XmlElement | undefined => {
    const found = element.children.filter((child) => child.name === name);
    if (found.length > 1 || (required && found.length !== 1)) {
      problem(
        'pob.ambiguous-selection',
        `Expected ${required ? 'exactly one' : 'at most one'} ${element.name}/${name}.`,
        { element: name },
        String(found.length),
        'ambiguous-stat',
      );
      return undefined;
    }
    return found[0];
  };
  if (root.name !== 'PathOfBuilding') {
    problem(
      'pob.unsupported-root',
      'Only a PoE1 PathOfBuilding document is supported.',
      { element: root.name },
      root.name,
    );
    return result();
  }
  check(root, [], ['Build', 'Skills', 'Items', 'Config', 'Tree', 'Notes']);
  const build = unique(root, 'Build');
  if (build) {
    check(
      build,
      ['level', 'className', 'ascendClassName', 'mainSocketGroup', 'targetVersion'],
      ['PlayerStat'],
    );
    for (const output of build.children)
      if (output.name === 'PlayerStat') check(output, ['stat', 'value']);
    if (
      build.attributes.level !== '1' ||
      build.attributes.className !== 'Witch' ||
      build.attributes.ascendClassName !== 'None' ||
      build.attributes.mainSocketGroup !== '1' ||
      build.attributes.targetVersion !== '3_0'
    )
      problem(
        'pob.unsupported-build',
        'Profile requires explicit targetVersion 3_0, level 1 Witch, no ascendancy and mainSocketGroup 1.',
        { element: 'Build' },
        JSON.stringify(build.attributes),
      );
  }
  const tree = unique(root, 'Tree', false);
  if (tree) {
    check(tree, [], ['Spec']);
    for (const spec of tree.children) {
      check(spec, ['nodes', 'classId', 'ascendClassId']);
      if (
        (spec.attributes.nodes ?? '') !== '' ||
        (spec.attributes.classId ?? '3') !== '3' ||
        (spec.attributes.ascendClassId ?? '0') !== '0'
      )
        problem(
          'pob.unsupported-passives',
          'Allocated passives and ascendancies are unsupported.',
          { element: 'Spec' },
          JSON.stringify(spec.attributes),
        );
    }
  }
  const notes = unique(root, 'Notes', false);
  if (notes) check(notes, [], [], true);
  const skillContainer = unique(root, 'Skills');
  let selected: PobImportedSkill | undefined;
  if (skillContainer) {
    check(skillContainer, [], ['Skill']);
    const group = unique(skillContainer, 'Skill');
    if (group) {
      check(group, ['enabled', 'mainActiveSkill', 'skillPart', 'label', 'slot'], ['Gem']);
      if (
        group.attributes.enabled !== 'true' ||
        group.attributes.mainActiveSkill !== '1' ||
        group.attributes.skillPart !== '1'
      )
        problem(
          'pob.ambiguous-selection',
          'One enabled group with mainActiveSkill 1 and explicit skillPart 1 Hit is required.',
          { element: 'Skill' },
          JSON.stringify(group.attributes),
          'ambiguous-stat',
        );
      const gem = unique(group, 'Gem');
      if (gem) {
        check(gem, ['skillId', 'gemId', 'nameSpec', 'level', 'quality', 'enabled']);
        const level = integer(gem.attributes.level, 1, 40);
        const quality = integer(gem.attributes.quality, 0, 100);
        if (
          gem.attributes.skillId !== 'Spark' ||
          gem.attributes.gemId !== 'Metadata/Items/Gems/SkillGemSpark' ||
          gem.attributes.nameSpec !== 'Spark' ||
          gem.attributes.enabled !== 'true' ||
          level === undefined ||
          quality === undefined
        )
          problem(
            'pob.unsupported-skill',
            'Require enabled normal Spark with exact IDs, level 1–40 and ordinary quality 0–100.',
            { element: 'Gem' },
            JSON.stringify(gem.attributes),
          );
        else {
          selected = {
            gameSkillId: 'Spark',
            level,
            quality,
            enabled: true,
            source: { element: 'Gem', attribute: 'skillId' },
          };
          skills.push(selected);
        }
      }
    }
  }
  const config = unique(root, 'Config');
  let resistance: number | undefined;
  if (config) {
    check(config, [], ['Input']);
    const inputs = new Map<string, XmlElement>();
    for (const input of config.children) {
      check(input, ['name', 'number', 'string']);
      const name = input.attributes.name ?? '';
      if (inputs.has(name))
        problem(
          'pob.ambiguous-configuration',
          `Duplicate configuration ${name}.`,
          { element: 'Input' },
          JSON.stringify(input.attributes),
          'ambiguous-stat',
        );
      inputs.set(name, input);
      if (!['enemyIsBoss', 'enemyLightningResist', 'customMods'].includes(name))
        problem(
          'pob.unsupported-configuration',
          `Unsupported configuration ${name}.`,
          { element: 'Input' },
          JSON.stringify(input.attributes),
        );
    }
    const boss = inputs.get('enemyIsBoss');
    const crit = inputs.get('customMods');
    const resist = inputs.get('enemyLightningResist');
    if (
      !boss ||
      boss.attributes.string !== 'None' ||
      boss.attributes.number !== undefined ||
      !crit ||
      crit.attributes.string !== 'Never deal Critical Strikes' ||
      crit.attributes.number !== undefined ||
      !resist ||
      resist.attributes.string !== undefined ||
      !/^-?[0-9]+(?:\.[0-9]+)?$/.test(resist.attributes.number ?? '')
    )
      problem(
        'pob.missing-configuration',
        'Require explicit enemyIsBoss=None, numeric enemyLightningResist and customMods=Never deal Critical Strikes.',
        { element: 'Config' },
        JSON.stringify([...inputs.keys()]),
        'malformed-input',
      );
    else {
      resistance = Number(resist.attributes.number);
      if (!Number.isFinite(resistance) || resistance < -200 || resistance > 90) {
        problem(
          'pob.invalid-resistance',
          'PoB profile resistance must be between -200 and 90 percent; no cap is inferred.',
          { element: 'Input', attribute: 'number' },
          resist.attributes.number ?? '',
          'malformed-input',
        );
        resistance = undefined;
      }
    }
  }
  const items = unique(root, 'Items', false);
  if (items) {
    check(items, ['activeItemSet'], ['Item', 'ItemSet']);
    const itemSet = unique(items, 'ItemSet');
    const itemNodes = items.children.filter((node) => node.name === 'Item');
    if (itemNodes.length > 1)
      problem(
        'pob.unsupported-items',
        'At most one equipped synthetic Simple Robe is supported.',
        { element: 'Items' },
        String(itemNodes.length),
      );
    let equippedId: string | undefined;
    if (itemSet) {
      check(itemSet, ['id'], ['Slot']);
      if (itemSet.attributes.id !== '1' || (items.attributes.activeItemSet ?? '1') !== '1')
        problem(
          'pob.ambiguous-item-set',
          'Only active item set 1 is supported.',
          { element: 'ItemSet' },
          JSON.stringify(itemSet.attributes),
          'ambiguous-stat',
        );
      if (itemSet.children.length > 1)
        problem(
          'pob.unsupported-items',
          'Only the Body Armour slot is supported.',
          { element: 'ItemSet' },
          String(itemSet.children.length),
        );
      for (const slot of itemSet.children) {
        check(slot, ['name', 'itemId']);
        if (
          slot.attributes.name !== 'Body Armour' ||
          !/^[1-9][0-9]*$/.test(slot.attributes.itemId ?? '')
        )
          problem(
            'pob.unsupported-item-slot',
            'Require explicit Body Armour item ID.',
            { element: 'Slot' },
            JSON.stringify(slot.attributes),
          );
        else equippedId = slot.attributes.itemId;
      }
    }
    if ((itemNodes.length === 1 && !equippedId) || (itemNodes.length === 0 && equippedId))
      problem(
        'pob.ambiguous-item-selection',
        'Item definitions and equipped item ID must agree.',
        { element: 'Items' },
        equippedId ?? '',
        'ambiguous-stat',
      );
    for (const item of itemNodes) {
      check(item, ['id'], [], true);
      const itemId = item.attributes.id;
      if (itemId !== equippedId)
        problem(
          'pob.ambiguous-item-selection',
          'Each item must be the selected equipped item.',
          { element: 'Item' },
          itemId ?? '',
          'ambiguous-stat',
        );
      const lines = item.text.split('\n');
      let lineOffset = 0;
      while (lines[0]?.trim() === '') {
        lines.shift();
        lineOffset++;
      }
      while (lines[lines.length - 1]?.trim() === '') lines.pop();
      if (lines.length > 64 || lines.some((line) => line.length > 2048)) {
        problem(
          'pob.item-limit',
          'Item limit: 64 lines of 2048 characters.',
          { element: 'Item', ...(itemId ? { itemId } : {}) },
          '',
          'malformed-input',
        );
        continue;
      }
      if (
        lines[0]?.trim() !== 'Rarity: RARE' ||
        lines[1]?.trim() !== 'Synthetic Spark Fixture' ||
        lines[2]?.trim() !== 'Simple Robe' ||
        lines[3]?.trim() !== 'Implicits: 0'
      ) {
        problem(
          'pob.unsupported-item-base',
          'Require synthetic rare Simple Robe with zero implicit modifiers.',
          { element: 'Item', ...(itemId ? { itemId } : {}) },
          item.text,
        );
        continue;
      }
      for (let index = 4; index < lines.length; index++) {
        const raw = lines[index]!;
        const line = raw.trim();
        if (!line) continue;
        const addedMatch = /^Adds ([0-9]+) to ([0-9]+) Lightning Damage to Spells$/.exec(line);
        if (addedMatch) {
          const min = Number(addedMatch[1]);
          const max = Number(addedMatch[2]);
          if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max)
            problem(
              'pob.invalid-added-lightning-range',
              'Added spell lightning damage needs ordered nonnegative safe integer endpoints.',
              { element: 'Item', ...(itemId ? { itemId } : {}), textLine: lineOffset + index + 1 },
              raw,
              'malformed-input',
            );
          else
            addedLightningDamage.push({
              statIds: [
                'spell_minimum_added_lightning_damage',
                'spell_maximum_added_lightning_damage',
              ],
              values: [min, max],
              scope: 'global',
              source: {
                kind: 'item',
                id: `pob-item:${itemId}`,
                line: lineOffset + index + 1,
                label: raw,
              },
            });
          continue;
        }
        const matches = rules.flatMap(([pattern, statId]) => {
          const match = pattern.exec(line);
          return match
            ? [{ statId, value: Number(match[1]) * (match[2] === 'reduced' ? -1 : 1) }]
            : [];
        });
        if (matches.length !== 1 || !Number.isFinite(matches[0]?.value))
          problem(
            matches.length > 1 ? 'pob.ambiguous-stat' : 'pob.unsupported-item-line',
            'Item line is outside the exact supported grammar.',
            { element: 'Item', ...(itemId ? { itemId } : {}), textLine: lineOffset + index + 1 },
            raw,
            matches.length > 1 ? 'ambiguous-stat' : 'unknown-stat',
          );
        else
          modifiers.push({
            ...matches[0]!,
            scope: 'global',
            source: {
              kind: 'item',
              id: `pob-item:${itemId}`,
              line: lineOffset + index + 1,
              label: raw,
            },
          });
      }
    }
  }
  if (diagnostics.length || !selected || resistance === undefined) return result();
  return result({
    identity,
    buildId,
    skill: {
      id: 'Spark',
      gemLevel: selected.level,
      quality: selected.quality,
      variant: 'normal',
      statSet: 'base',
      supports: [],
    },
    configuration: { id: configurationId, effectiveLightningResistancePercent: resistance },
    modifiers,
    ...(addedLightningDamage.length ? { addedLightningDamage } : {}),
  });
}
