import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStatDescriptions,
  matchStatLine,
  parseItemText,
  renderStatGroup,
} from '@exile-engine/item-text';

const source = `no_description hidden_example
include "Metadata/StatDescriptions/other_stat_descriptions.txt"
description spell_damage_incr
1 spell_damage_+%
2
1|# "{0}% increased Spell Damage"
#|-1 "{0}% reduced Spell Damage" negate 1
lang "Thai"
2
1|# "เพิ่มความเสียหาย เวท {0}%"
#|-1 "ลดความเสียหาย เวท {0}%" negate 1
description
1 base_cast_speed_+%
1
1|# "{0}% increased Cast Speed"
lang "Thai"
1
1|# "เพิ่มความเร็วในการร่าย {0}%"
description
2 local_minimum_added_fire_damage local_maximum_added_fire_damage
1
# # "Adds {0} to {1} Fire Damage"
lang "Thai"
1
# # "เสริมความเสียหาย ไฟ {0} ถึง {1}"
`;
const parsed = parseStatDescriptions(source, {
  sourcePath: 'Metadata/StatDescriptions/stat_descriptions.txt',
});
const catalog = {
  descriptions: parsed.rules,
  bases: [
    {
      id: 'Metadata/Items/Weapons/OneHandWeapons/Wands/Wand1',
      itemClassId: 'Wand',
      names: { en: 'Driftwood Wand', th: 'ไม้กายสิทธิ์ไม้ลอยน้ำ' },
    },
  ],
};
const identity = { game: 'poe1', build: 'test-build', snapshotId: 'test-snapshot' };

test('SD parser retains real IDs, aliases, locales, includes and no_description directives', () => {
  assert.deepEqual(parsed.diagnostics, []);
  assert.equal(parsed.rules.length, 6);
  assert.equal(parsed.rules[0].descriptionName, 'spell_damage_incr');
  assert.deepEqual(parsed.rules[0].statIds, ['spell_damage_+%']);
  assert.equal(parsed.rules[1].locale, 'th');
  assert.equal(parsed.rules[0].groupId, parsed.rules[1].groupId);
  assert.deepEqual(parsed.noDescriptionStatIds, ['hidden_example']);
  assert.equal(parsed.includes.length, 1);
});

test('English and Thai numbers resolve to exact raw stat IDs and alternate rendering', () => {
  const en = matchStatLine('28% increased Spell Damage', catalog);
  assert.equal(en.status, 'matched');
  assert.deepEqual(en.selected.stats, [{ statId: 'spell_damage_+%', value: 28 }]);
  assert.equal(renderStatGroup(en.selected, 'th', catalog).text, 'เพิ่มความเสียหาย เวท 28%');
  const th = matchStatLine('เพิ่มความเสียหาย เวท ๒๘%', catalog, { locale: 'th' });
  assert.deepEqual(th.selected.stats, en.selected.stats);
  const reduced = matchStatLine('12% reduced Spell Damage', catalog);
  assert.equal(reduced.selected.values[0], -12);
  assert.equal(renderStatGroup(reduced.selected, 'th', catalog).text, 'ลดความเสียหาย เวท 12%');
});

test('multi-stat descriptions stay one ordered group and retain unsupported mechanics', () => {
  const group = matchStatLine('Adds 2 to 9 Fire Damage', catalog);
  assert.equal(group.status, 'matched');
  assert.equal(group.selected.supported, false);
  assert.deepEqual(group.selected.values, [2, 9]);
  assert.equal(renderStatGroup(group.selected, 'th', catalog).text, 'เสริมความเสียหาย ไฟ 2 ถึง 9');
});

test('equivalent matches reconcile while different stat interpretations remain ambiguous', () => {
  const original = parsed.rules[0];
  const duplicate = { ...original, id: original.id + '-duplicate' };
  const equivalent = matchStatLine('28% increased Spell Damage', {
    descriptions: [original, duplicate],
  });
  assert.equal(equivalent.status, 'matched');
  assert.equal(equivalent.selected.ruleIds.length, 2);
  const different = { ...original, id: 'other', statIds: ['lightning_damage_+%'] };
  const ambiguous = matchStatLine('28% increased Spell Damage', {
    descriptions: [original, different],
  });
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.selected, undefined);
  assert.equal(ambiguous.candidates.length, 2);
});

test('clipboard parser preserves identity, line attribution and unresolved source lines', () => {
  const text = `Item Class: Wands\nRarity: Rare\nStorm Song\nDriftwood Wand\n--------\nWand\nPhysical Damage: 5-9\n--------\nItem Level: 40\n--------\n28% increased Spell Damage\n10% increased Cast Speed\nAdds 2 to 9 Fire Damage\nAn unknown mechanic`;
  const item = parseItemText(text, catalog, { identity });
  assert.equal(item.itemClass, 'Wands');
  assert.equal(item.rarity, 'Rare');
  assert.equal(item.baseCandidates[0].id, catalog.bases[0].id);
  assert.equal(item.complete, false);
  assert.deepEqual(
    item.modifiers.map((x) => x.statId),
    ['spell_damage_+%', 'base_cast_speed_+%'],
  );
  assert.equal(item.modifiers[0].source.line, 11);
  assert.equal(item.lines.at(-1).text, 'An unknown mechanic');
  assert.equal(item.groups.at(-1).status, 'unmatched');
  assert.equal(
    item.groups.find((group) => group.sourceText.startsWith('Adds')).selected.supported,
    false,
  );
});

test('Thai clipboard parsing uses the same canonical stats', () => {
  const item = parseItemText(
    'ประเภทไอเทม: ไม้กายสิทธิ์\nความหายาก: แรร์\nชื่อทดสอบ\nไม้กายสิทธิ์ไม้ลอยน้ำ\n--------\nเพิ่มความเสียหาย เวท 28%\nเพิ่มความเร็วในการร่าย 10%',
    catalog,
    { identity, locale: 'th' },
  );
  assert.equal(item.baseCandidates.length, 1);
  assert.equal(item.complete, true);
  assert.deepEqual(
    item.modifiers.map((x) => x.value),
    [28, 10],
  );
});

test('unidentified items and unresolved base identity cannot claim complete calculation input', () => {
  const text =
    'Item Class: Wands\nRarity: Rare\nStorm Song\nDriftwood Wand\n--------\n28% increased Spell Damage';
  const unidentified = parseItemText(text + '\nUnidentified', catalog, { identity });
  assert.equal(unidentified.complete, false);
  assert.equal(
    unidentified.diagnostics.find((d) => d.code === 'unidentified-item').severity,
    'error',
  );
  const unknownBase = parseItemText(text, { descriptions: catalog.descriptions }, { identity });
  assert.equal(unknownBase.complete, false);
  assert.equal(unknownBase.diagnostics.find((d) => d.code === 'unknown-base').severity, 'error');
  const ambiguousBase = parseItemText(
    text,
    { ...catalog, bases: [...catalog.bases, { ...catalog.bases[0], id: 'another-base' }] },
    { identity },
  );
  assert.equal(ambiguousBase.complete, false);
  assert.equal(
    ambiguousBase.diagnostics.find((d) => d.code === 'ambiguous-base').severity,
    'error',
  );
});

test('unsupported transforms, placeholder formats and lossy inverses never invent values', () => {
  for (const tail of ['unsupported_transform 1', 'divide_by_ten_1dp 1']) {
    const rules = parseStatDescriptions(
      `description\n1 spell_damage_+%\n1\n# "{0}% increased Spell Damage" ${tail}`,
    ).rules;
    assert.equal(
      matchStatLine('28% increased Spell Damage', { descriptions: rules }).status,
      'unmatched',
    );
  }
  const rules = parseStatDescriptions(
    'description\n1 spell_damage_+%\n1\n# "{0:banana}% increased Spell Damage"',
  ).rules;
  assert.equal(
    matchStatLine('28% increased Spell Damage', { descriptions: rules }).status,
    'unmatched',
  );
  const unsafeCaptures = parseStatDescriptions(
    'description\n2 first second\n1\n# # "{0}{1} damage"',
  ).rules;
  assert.equal(
    matchStatLine('1234567890 damage', { descriptions: unsafeCaptures }).status,
    'unmatched',
  );
});

test('malformed SD input and configured work limits fail visibly', () => {
  assert.equal(
    parseStatDescriptions('description\n2 one\n1\n# "bad"').diagnostics[0].code,
    'invalid-stat-declaration',
  );
  assert.throws(() => parseStatDescriptions(source, { maxLines: 2 }), RangeError);
  assert.throws(
    () => parseItemText('a'.repeat(100), catalog, { identity, limits: { maxTextLength: 10 } }),
    RangeError,
  );
  assert.throws(
    () => matchStatLine('28% increased Spell Damage', catalog, { maxCandidates: 0 }),
    RangeError,
  );
});

test('handed descriptions retain both exact stat groups instead of guessing a hand', () => {
  const data = parseStatDescriptions(
    `handed_description weapon_physical_damage_range
2
main_hand_minimum_physical_damage main_hand_maximum_physical_damage
off_hand_minimum_physical_damage off_hand_maximum_physical_damage
1
# # "{0} to {1} Physical Damage"
lang "Thai"
1
# # "ความเสียหายกายภาพ {0} ถึง {1}"`,
    { sourcePath: 'skill_stat_descriptions.txt' },
  );
  assert.deepEqual(data.diagnostics, []);
  assert.equal(data.rules.length, 4);
  assert.deepEqual(
    data.rules.filter((rule) => rule.locale === 'en').map((rule) => rule.hand),
    ['main', 'off'],
  );
  assert.equal(
    matchStatLine('5 to 12 Physical Damage', { descriptions: data.rules }).status,
    'ambiguous',
  );
});

test('all source flags, handlers, malformed ranges and unknown directives remain inspectable', () => {
  const data = parseStatDescriptions(`no_identifiers
future_directive some payload
description
1 base_cast_speed_+%
2
# gem_quality "{0}% increased Cast Speed" negate 1 reminderstring ReminderTextExample
1|99# table_only "Cast Speed@{0}%" display_indexable_skill 1 0`);
  assert.deepEqual(data.directives, [{ name: 'no_identifiers', args: [], line: 1 }]);
  assert.equal(data.unparsedLines[0].text, 'future_directive some payload');
  assert.deepEqual(data.rules[0].variants[0].flags, ['gem_quality']);
  assert.deepEqual(data.rules[0].variants[0].transforms, [
    { name: 'negate', args: ['1'] },
    { name: 'reminderstring', args: ['ReminderTextExample'] },
  ]);
  assert.deepEqual(data.rules[0].variants[1].ranges[0], { kind: 'unsupported', raw: '1|99#' });
  assert.equal(
    data.rules[0].variants[1].rawLine,
    '1|99# table_only "Cast Speed@{0}%" display_indexable_skill 1 0',
  );
  assert.equal(
    matchStatLine('20% increased Cast Speed', { descriptions: data.rules }).status,
    'unmatched',
  );
});

test('multiple numeric transforms apply to their own positions and round-trip exact integer values', () => {
  const data = parseStatDescriptions(`description
2 first_stat second_stat
1
# # "First {0}; second {1}" negate 1 divide_by_one_hundred 2
lang "Thai"
1
# # "ค่าแรก {0}; ค่าที่สอง {1}" negate 1 divide_by_one_hundred 2`);
  const group = matchStatLine('First 12; second 0.25', { descriptions: data.rules });
  assert.deepEqual(group.selected.values, [-12, 25]);
  assert.equal(
    renderStatGroup(group.selected, 'th', { descriptions: data.rules }).text,
    'ค่าแรก 12; ค่าที่สอง 0.25',
  );
  assert.equal(
    matchStatLine('First 12; second 0.251', { descriptions: data.rules }).status,
    'unmatched',
  );
});

test('literal newlines in original client descriptions stay in the parsed catalog', () => {
  const text =
    'description\n1 ignite_faster_burn_%_applies_to_ignite_proliferation_delay_ms\n1\n# "[DNT] Faster ignite also lowers the spread delay\n"';
  const data = parseStatDescriptions(text);
  assert.deepEqual(data.diagnostics, []);
  assert.equal(
    data.rules[0].variants[0].text,
    '[DNT] Faster ignite also lowers the spread delay\n',
  );
  assert.equal(
    matchStatLine('[DNT] Faster ignite also lowers the spread delay', { descriptions: data.rules })
      .status,
    'unmatched',
  );
});

test('overflowing transforms and unsupported constant-text handlers cannot produce false matches', () => {
  for (const tail of [
    Array(200).fill('multiply_by_one_hundred 1').join(' '),
    Array(80).fill('multiply_by_one_hundred 1').join(' '),
    Array(80).fill('divide_by_one_hundred 1').join(' '),
  ]) {
    const data = parseStatDescriptions(
      `description\n1 spell_damage_+%\n1\n# "{0}% increased Spell Damage" ${tail}`,
    );
    assert.equal(
      matchStatLine('28% increased Spell Damage', { descriptions: data.rules }).status,
      'unmatched',
    );
  }
  const data = parseStatDescriptions(
    'description\n1 spell_damage_+%\n1\n20 "Increased Spell Damage" unknown_transform 1',
  );
  assert.equal(
    matchStatLine('Increased Spell Damage', { descriptions: data.rules }).status,
    'unmatched',
  );
  assert.equal(
    renderStatGroup(
      { groupId: data.rules[0].groupId, statIds: ['spell_damage_+%'], values: [20] },
      'en',
      { descriptions: data.rules },
    ).ok,
    false,
  );
});

test('rounded native handlers render correctly but never assert a unique inverse', () => {
  for (const [handler, value, expected] of [
    ['per_minute_to_per_second', 73, '1.2'],
    ['divide_by_one_hundred_and_negate', 125, '-1.3'],
  ]) {
    const data = parseStatDescriptions(`description\n1 sample_stat\n1\n# "{0}" ${handler} 1`);
    const catalog = { descriptions: data.rules };
    assert.equal(matchStatLine(expected, catalog).status, 'unmatched');
    assert.equal(
      renderStatGroup(
        { groupId: data.rules[0].groupId, statIds: ['sample_stat'], values: [value] },
        'en',
        catalog,
      ).text,
      expected,
    );
  }
  const data = parseStatDescriptions(
    'description\n1 sample_stat\n1\n# "{0:.1f}" divide_by_one_hundred 1',
  );
  assert.equal(matchStatLine('1.2', { descriptions: data.rules }).status, 'unmatched');
});

test('unsuccessful matches consume standalone and whole-item attempt budgets', () => {
  const rules = parseStatDescriptions(
    'description\n1 spell_damage_+%\n1\n# "{0}% increased Spell Damage"',
  ).rules;
  const catalog = { descriptions: rules };
  assert.throws(
    () => matchStatLine('No matching text', catalog, { maxAttempts: 1 }),
    /matching attempts/,
  );
  assert.equal(matchStatLine('No matching text', catalog, { maxAttempts: 2 }).status, 'unmatched');
  const text = 'Rarity: Rare\nDriftwood Wand\n--------\nFirst unknown line\nSecond unknown line';
  assert.throws(
    () => parseItemText(text, catalog, { identity, limits: { maxMatchAttempts: 3 } }),
    /matching attempts/,
  );
  assert.equal(
    parseItemText(text, catalog, { identity, limits: { maxMatchAttempts: 4 } }).groups.length,
    2,
  );
  assert.throws(
    () => matchStatLine('No matching text', catalog, { maxAttempts: Infinity }),
    RangeError,
  );
});

test('duplicate client language sections retain separate stable rule IDs and shared group identity', () => {
  const text =
    'description\n1 spell_damage_+%\n1\n# "{0}% Spell Damage"\nlang "Portuguese"\n1\n# "Dano {0}%"\nlang "Portuguese"\n1\n# "Dano mágico {0}%"';
  const first = parseStatDescriptions(text, { sourcePath: 'atlas_variant_stat_descriptions.csd' });
  const second = parseStatDescriptions(text, { sourcePath: 'atlas_variant_stat_descriptions.csd' });
  assert.deepEqual(first.diagnostics, []);
  assert.equal(new Set(first.rules.map((rule) => rule.id)).size, 3);
  assert.deepEqual(
    first.rules.map((rule) => rule.id),
    second.rules.map((rule) => rule.id),
  );
  assert.equal(first.rules[1].groupId, first.rules[2].groupId);
  assert.deepEqual(
    first.rules.slice(1).map((rule) => rule.locale),
    ['pt', 'pt'],
  );
  assert.equal(first.rules[2].variants[0].text, 'Dano mágico {0}%');
});
