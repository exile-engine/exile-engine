import {
  isSnapshotIdentity,
  type AddedLightningDamageContribution,
  type Diagnostic,
  type SelectedSkillInput,
  type SelectedSkillSupport,
  type SelectedLightningExposure,
  type SelectedConductivityConfiguration,
  type SourceRef,
  type SnapshotIdentity,
  type StatContribution,
} from '@exile-engine/core';
import { parseXml, XmlError, type PobXmlLimits, type XmlElement } from './xml.js';

export { pobXmlLimits, type PobXmlLimits } from './xml.js';
export const pobAdapterVersion = 'poe1-spark-xml-v8';
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
  /** Explicit host time weight: PoB XML supplies only an active/inactive shock endpoint. */
  readonly shockUptimePercent?: number;
}
export interface PobSourceLocation {
  readonly element: string;
  readonly attribute?: string;
  readonly itemId?: string;
  readonly textLine?: number;
  readonly socketGroup?: number;
  readonly gemIndex?: number;
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
  readonly supports: readonly SelectedSkillSupport[];
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
  [/^([0-9]+)% (increased|reduced) Damage$/, 'damage_+%'],
  [/^([0-9]+)% (increased|reduced) Spell Damage$/, 'spell_damage_+%'],
  [/^([0-9]+)% (increased|reduced) Lightning Damage$/, 'lightning_damage_+%'],
  [/^([0-9]+)% (increased|reduced) Projectile Damage$/, 'projectile_damage_+%'],
  [/^([0-9]+)% (increased|reduced) Cast Speed$/, 'base_cast_speed_+%'],
  [/^([0-9]+)% (increased|reduced) Critical Strike Chance$/, 'critical_strike_chance_+%'],
  [
    /^([0-9]+)% (increased|reduced) Critical Strike Chance for Spells$/,
    'spell_critical_strike_chance_+%',
  ],
  [/^\+([0-9]+)% to Global Critical Strike Multiplier$/, 'base_critical_strike_multiplier_+'],
  [
    /^Damage Penetrates ([0-9]+)% Lightning Resistance$/,
    'base_reduce_enemy_lightning_resistance_%',
  ],
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
  const supports: SelectedSkillSupport[] = [];
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
    supports,
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
    if (
      !['format', 'xml', 'target', 'buildId', 'configurationId', 'shockUptimePercent'].includes(key)
    )
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
  let conductivitySelection:
    Omit<SelectedConductivityConfiguration, 'increasedEffectPercent' | 'effectSource'> | undefined;
  let conductivityEffect: { increasedEffectPercent: number; source: SourceRef } | undefined;
  if (skillContainer) {
    check(skillContainer, [], ['Skill']);
    const groups = skillContainer.children.filter((child) => child.name === 'Skill');
    if (groups.length < 1 || groups.length > 2)
      problem(
        'pob.ambiguous-selection',
        'Require selected Spark group 1 and at most one configured Conductivity group 2.',
        { element: 'Skills' },
        String(groups.length),
        'ambiguous-stat',
      );
    const group = groups[0];
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
      const gems = group.children.filter((child) => child.name === 'Gem');
      if (gems.length < 1 || gems.length > 3)
        problem(
          'pob.ambiguous-selection',
          'Require Spark first, followed by at most one each of normal Controlled Destruction and Faster Casting.',
          { element: 'Skill', socketGroup: 1 },
          JSON.stringify(gems),
          'ambiguous-stat',
        );
      const gem = gems[0];
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
      const seenSupports = new Set<string>();
      for (let gemIndex = 1; gemIndex < gems.length; gemIndex++) {
        const supportGem = gems[gemIndex]!;
        check(supportGem, ['skillId', 'gemId', 'nameSpec', 'level', 'quality', 'enabled']);
        const gemLevel = integer(supportGem.attributes.level, 1, 20);
        const profile = [
          {
            id: 'SupportControlledDestruction',
            gemId: 'Metadata/Items/Gems/SupportGemControlledDestruction',
            name: 'Controlled Destruction',
          },
          {
            id: 'SupportFasterCasting',
            gemId: 'Metadata/Items/Gems/SupportGemFasterCast',
            name: 'Faster Casting',
          },
        ].find((candidate) => candidate.id === supportGem.attributes.skillId);
        if (
          gemIndex > 2 ||
          !profile ||
          seenSupports.has(profile.id) ||
          supportGem.attributes.gemId !== profile.gemId ||
          supportGem.attributes.nameSpec !== profile.name ||
          gemLevel === undefined ||
          supportGem.attributes.quality !== '0' ||
          !['true', 'false'].includes(supportGem.attributes.enabled ?? '')
        )
          problem(
            'pob.unsupported-support',
            'Only unique normal Controlled Destruction and Faster Casting supports, levels 1–20, quality 0 and explicit enabled state are supported in the selected group.',
            { element: 'Gem', socketGroup: 1, gemIndex: gemIndex + 1 },
            JSON.stringify(supportGem.attributes),
          );
        else
          supports.push({
            id: profile.id,
            gemLevel,
            quality: 0,
            enabled: supportGem.attributes.enabled === 'true',
            source: {
              kind: 'skill',
              id: `pob-gem:1:${gemIndex + 1}`,
              label: profile.name,
            },
          });
        if (profile) seenSupports.add(profile.id);
      }
    }
    const curseGroup = groups[1];
    if (curseGroup) {
      check(curseGroup, ['enabled', 'mainActiveSkill', 'skillPart', 'label'], ['Gem']);
      const curseGems = curseGroup.children.filter((child) => child.name === 'Gem');
      const gem = curseGems[0];
      if (gem) check(gem, ['skillId', 'gemId', 'nameSpec', 'level', 'quality', 'enabled']);
      const gemLevel = integer(gem?.attributes.level, 1, 20);
      if (
        curseGroup.attributes.enabled !== 'true' ||
        curseGroup.attributes.mainActiveSkill !== '1' ||
        curseGroup.attributes.skillPart !== '1' ||
        curseGems.length !== 1 ||
        !gem ||
        gem.attributes.skillId !== 'Conductivity' ||
        gem.attributes.gemId !== 'Metadata/Items/Gems/SkillGemConductivity' ||
        gem.attributes.nameSpec !== 'Conductivity' ||
        gem.attributes.quality !== '0' ||
        gemLevel === undefined ||
        !['true', 'false'].includes(gem.attributes.enabled ?? '')
      )
        problem(
          'pob.unsupported-conductivity',
          'Group 2 must be enabled with one normal Conductivity, level 1–20, quality 0, explicit gem enabled state and skillPart 1; curse supports and other groups are unsupported.',
          { element: 'Skill', socketGroup: 2 },
          JSON.stringify(curseGroup.attributes),
        );
      else
        conductivitySelection = {
          id: 'Conductivity',
          gemLevel,
          quality: 0,
          enabled: gem.attributes.enabled === 'true',
          source: { kind: 'scenario', id: 'pob-gem:2:1', label: 'Conductivity' },
        };
    }
  }
  const config = unique(root, 'Config');
  let resistance: number | undefined;
  let averageCriticalStrikes = false;
  let maximumResistanceMode: 'configured' | 'default75' = 'configured';
  let resistanceSource: SourceRef | undefined;
  let shock: { magnitudePercent: number; uptimePercent: number; source: SourceRef } | undefined;
  const exposures: SelectedLightningExposure[] = [];
  if (config) {
    check(config, [], ['Input', 'CustomModifierBlock']);
    const inputs = new Map<string, XmlElement>();
    for (const input of config.children.filter((child) => child.name === 'Input')) {
      check(input, ['name', 'number', 'string', 'boolean']);
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
      if (
        ![
          'enemyIsBoss',
          'enemyLightningResist',
          'enemyMaxResist',
          'customMods',
          'conditionEnemyShocked',
          'conditionShockEffect',
        ].includes(name)
      )
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
    const maximum = inputs.get('enemyMaxResist');
    const shocked = inputs.get('conditionEnemyShocked');
    const shockEffect = inputs.get('conditionShockEffect');
    if (
      shocked ||
      shockEffect ||
      Object.hasOwn(source, 'shockUptimePercent') ||
      source.shockUptimePercent !== undefined
    ) {
      const magnitude = integer(shockEffect?.attributes.number, 0, 50);
      const uptime = source.shockUptimePercent;
      if (
        !shocked ||
        !shockEffect ||
        !['true', 'false'].includes(shocked.attributes.boolean ?? '') ||
        shocked.attributes.number !== undefined ||
        shocked.attributes.string !== undefined ||
        shockEffect.attributes.boolean !== undefined ||
        shockEffect.attributes.string !== undefined ||
        magnitude === undefined ||
        !Object.hasOwn(source, 'shockUptimePercent') ||
        !Number.isSafeInteger(uptime) ||
        uptime! < 0 ||
        uptime! > 100 ||
        (shocked.attributes.boolean === 'false' && uptime !== 0)
      )
        problem(
          'pob.invalid-shock',
          'Configured shock requires both native conditionEnemyShocked/conditionShockEffect fields, integer magnitude 0–50 and an explicit host shockUptimePercent integer 0–100. Native false requires uptime 0.',
          { element: 'Config' },
          JSON.stringify({
            conditionEnemyShocked: shocked?.attributes,
            conditionShockEffect: shockEffect?.attributes,
            shockUptimePercent: typeof uptime === 'number' ? uptime : typeof uptime,
          }),
          'malformed-input',
        );
      else
        shock = {
          magnitudePercent: magnitude,
          uptimePercent: uptime!,
          source: {
            kind: 'scenario',
            id: 'pob-config:shock',
            label: `conditionEnemyShocked=${shocked.attributes.boolean}; conditionShockEffect=${shockEffect.attributes.number}; host shockUptimePercent=${uptime}`,
          },
        };
    }
    const blocks = config.children.filter((child) => child.name === 'CustomModifierBlock');
    let declaration: string | undefined;
    if (blocks.length) {
      if (crit)
        problem(
          'pob.ambiguous-assumptions',
          'Legacy customMods and CustomModifierBlock cannot be mixed: the pinned PoB loader ignores the legacy declaration when blocks exist.',
          { element: 'Config' },
          crit.attributes.string ?? '',
          'ambiguous-stat',
        );
      const titles = new Set<string>();
      let assumptions = 0;
      if (blocks.length > 10)
        problem(
          'pob.exposure-limit',
          'At most one assumptions block, one Conductivity Effect block and eight exposure blocks are supported.',
          { element: 'Config' },
          String(blocks.length),
          'malformed-input',
        );
      for (const block of blocks) {
        check(block, ['title', 'enabled'], [], true);
        const title = block.attributes.title ?? '';
        const enabled = block.attributes.enabled;
        const text = block.text.trim();
        if (
          !title ||
          title.length > 128 ||
          titles.has(title) ||
          !['true', 'false'].includes(enabled ?? '')
        ) {
          problem(
            'pob.ambiguous-exposure-source',
            'Modifier block titles must be nonempty, unique and bounded, with explicit enabled state.',
            { element: 'CustomModifierBlock' },
            JSON.stringify(block.attributes),
            'ambiguous-stat',
          );
          continue;
        }
        titles.add(title);
        if (title === 'Conductivity Effect') {
          const match = /^([0-9]+)% (increased|reduced) Effect of your Curses$/.exec(text);
          const amount = match ? Number(match[1]) * (match[2] === 'reduced' ? -1 : 1) : NaN;
          if (
            enabled !== 'true' ||
            !match ||
            !Number.isSafeInteger(amount) ||
            amount < -100 ||
            amount > 200
          )
            problem(
              'pob.invalid-conductivity-effect',
              'Conductivity Effect must be an enabled block with exactly one integer increased/reduced Effect of your Curses, from -100 through 200 percent.',
              { element: 'CustomModifierBlock' },
              block.text,
              'malformed-input',
            );
          else {
            const line = block.text.split('\n').findIndex((value) => value.trim() !== '') + 1;
            conductivityEffect = {
              increasedEffectPercent: amount,
              source: {
                kind: 'scenario',
                id: 'pob-config:conductivity-effect',
                label: block.text.split('\n')[line - 1]!,
                line,
              },
            };
          }
          continue;
        }
        if (title === 'Exile Engine Assumptions') {
          assumptions++;
          if (
            enabled !== 'true' ||
            !['Never deal Critical Strikes', 'Cannot inflict Elemental Ailments'].includes(text)
          )
            problem(
              'pob.missing-configuration',
              'The reserved assumptions block must be enabled and contain exactly one supported mode declaration.',
              { element: 'CustomModifierBlock' },
              block.text,
              'malformed-input',
            );
          else declaration = text;
          continue;
        }
        const match =
          /^Inflict Lightning Exposure on Hit, applying -([0-9]+)% to Lightning Resistance$/.exec(
            text,
          );
        const magnitude = match ? Number(match[1]) : NaN;
        if (!match || !Number.isSafeInteger(magnitude) || magnitude > 100)
          problem(
            'pob.unsupported-exposure',
            'Only an explicitly configured already-active lightning exposure magnitude from 0 through 100 is supported.',
            { element: 'CustomModifierBlock' },
            block.text,
          );
        else {
          const line = block.text.split('\n').findIndex((value) => value.trim() !== '') + 1;
          exposures.push({
            statId: 'lightning_exposure_on_hit_magnitude',
            value: -magnitude,
            enabled: enabled === 'true',
            source: {
              kind: 'scenario',
              id: `pob-config:exposure:${title}`,
              label: block.text.split('\n')[line - 1]!,
              line,
            },
          });
        }
      }
      if (exposures.length > 8)
        problem(
          'pob.exposure-limit',
          'At most eight exposure candidates are supported.',
          { element: 'Config' },
          String(exposures.length),
          'malformed-input',
        );
      if (assumptions !== 1)
        problem(
          'pob.missing-configuration',
          'A block profile requires exactly one reserved Exile Engine Assumptions block.',
          { element: 'Config' },
          String(assumptions),
          'malformed-input',
        );
    } else if (
      crit &&
      crit.attributes.number === undefined &&
      crit.attributes.boolean === undefined
    )
      declaration = crit.attributes.string;
    if (
      !boss ||
      boss.attributes.string !== 'None' ||
      boss.attributes.number !== undefined ||
      boss.attributes.boolean !== undefined ||
      !['Never deal Critical Strikes', 'Cannot inflict Elemental Ailments'].includes(
        declaration ?? '',
      ) ||
      !resist ||
      resist.attributes.string !== undefined ||
      resist.attributes.boolean !== undefined ||
      !/^-?[0-9]+(?:\.[0-9]+)?$/.test(resist.attributes.number ?? '')
    )
      problem(
        'pob.missing-configuration',
        'Require explicit enemyIsBoss=None, numeric enemyLightningResist and one exact customMods literal: Never deal Critical Strikes, or Cannot inflict Elemental Ailments for average critical strikes with excluded ailments.',
        { element: 'Config' },
        JSON.stringify([...inputs.keys()]),
        'malformed-input',
      );
    else {
      averageCriticalStrikes = declaration === 'Cannot inflict Elemental Ailments';
      resistance = Number(resist.attributes.number);
      if (!Number.isSafeInteger(resistance) || resistance < -1000 || resistance > 1000) {
        problem(
          'pob.invalid-resistance',
          'Raw enemy lightning resistance must be an integer from -1000 through 1000 percent.',
          { element: 'Input', attribute: 'number' },
          resist.attributes.number ?? '',
          'malformed-input',
        );
        resistance = undefined;
      }
      resistanceSource = {
        kind: 'scenario',
        id: 'pob-config:enemyLightningResist',
        label: `enemyLightningResist=${resist.attributes.number}`,
      };
      if (
        maximum &&
        (maximum.attributes.number !== undefined ||
          maximum.attributes.string !== undefined ||
          !['true', 'false'].includes(maximum.attributes.boolean ?? ''))
      )
        problem(
          'pob.unsupported-resistance-cap',
          'enemyMaxResist must be an explicit boolean; arbitrary maximum resistance overrides are unsupported.',
          { element: 'Input', attribute: 'boolean' },
          JSON.stringify(maximum.attributes),
          'malformed-input',
        );
      else
        maximumResistanceMode = maximum?.attributes.boolean === 'true' ? 'default75' : 'configured';
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
        if (
          matches.length !== 1 ||
          !Number.isSafeInteger(matches[0]?.value) ||
          (matches[0]?.statId === 'base_reduce_enemy_lightning_resistance_%' &&
            (!Number.isSafeInteger(matches[0].value) ||
              matches[0].value < 0 ||
              matches[0].value > 200))
        )
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
  if (
    (conductivitySelection && (!conductivityEffect || !averageCriticalStrikes)) ||
    (conductivityEffect && !conductivitySelection)
  )
    problem(
      'pob.conductivity-configuration',
      'Configured Conductivity requires its group 2 gem, a Conductivity Effect block and the explicit Cannot inflict Elemental Ailments declaration. No default curse effect or generated shock is inferred.',
      { element: 'Config' },
      '',
      'malformed-input',
    );
  if (diagnostics.length || !selected || resistance === undefined || !resistanceSource)
    return result();
  return result({
    identity,
    buildId,
    skill: {
      id: 'Spark',
      gemLevel: selected.level,
      quality: selected.quality,
      variant: 'normal',
      statSet: 'base',
      supports,
    },
    configuration: {
      id: configurationId,
      lightningResistance: {
        baseResistancePercent: resistance,
        maximumResistanceMode,
        source: resistanceSource,
        exposures,
        ...(conductivitySelection && conductivityEffect
          ? {
              conductivity: {
                ...conductivitySelection,
                increasedEffectPercent: conductivityEffect.increasedEffectPercent,
                effectSource: conductivityEffect.source,
              },
            }
          : {}),
      },
      ...(averageCriticalStrikes
        ? { criticalStrikeMode: 'average' as const, ailmentMode: 'excluded' as const }
        : {}),
      ...(shock ? { shock, ailmentMode: 'configured-shock' as const } : {}),
    },
    modifiers,
    ...(addedLightningDamage.length ? { addedLightningDamage } : {}),
  });
}
