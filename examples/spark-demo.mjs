import { loadCatalog as loadPoe1 } from '@exile-engine/data-poe1';
import { loadCatalog as loadPoe2 } from '@exile-engine/data-poe2';
import * as poe1 from '@exile-engine/poe1';
import * as poe2 from '@exile-engine/poe2';
import { parseItemText, renderStatGroup, sparkWandStatIds } from '@exile-engine/item-text';

function requireValue(result, operation) {
  if (!result.ok) throw new Error(`${operation}: ${JSON.stringify(result.diagnostics)}`);
  return result.value;
}

/** A host-controlled demonstration, not an affix-tier or complete equipment validator. */
export async function runSparkDemo(game, readShard) {
  if (game !== 'poe1' && game !== 'poe2') throw new RangeError('Choose poe1 or poe2 explicitly.');
  const reader = await (game === 'poe1' ? loadPoe1 : loadPoe2)(readShard);
  const rules = game === 'poe1' ? poe1 : poe2;
  const scope = `${game === 'poe1' ? 'metadata' : 'data'}/statdescriptions/stat_descriptions`;
  const descriptions = (
    await Promise.all([reader.getDescriptions(scope, 'en'), reader.getDescriptions(scope, 'th')])
  ).flat();
  const bases = await reader.getTable('BaseItemTypes');
  const thaiBases = await reader.getLocalizedTable('BaseItemTypes', 'th');
  const thaiByKey = new Map(thaiBases.map((row) => [row.key, row]));
  const itemBases = bases.flatMap((row) => {
    const englishName = row.fields.Name;
    const thaiName = thaiByKey.get(row.key)?.fields.Name;
    const itemClass = row.fields.ItemClassesKey ?? row.fields.ItemClass;
    if (typeof englishName !== 'string') return [];
    return [
      {
        id: row.key,
        ...(itemClass?.kind === 'ref' ? { itemClassId: itemClass.key } : {}),
        names: { en: englishName, ...(typeof thaiName === 'string' ? { th: thaiName } : {}) },
      },
    ];
  });
  const counts = { en: new Map(), th: new Map() };
  for (const itemBase of itemBases)
    for (const locale of ['en', 'th']) {
      const name = itemBase.names[locale];
      if (name) counts[locale].set(name, (counts[locale].get(name) ?? 0) + 1);
    }
  const eligible = bases.filter((row) => {
    const itemClass = row.fields.ItemClassesKey ?? row.fields.ItemClass;
    const englishName = row.fields.Name;
    const thaiName = thaiByKey.get(row.key)?.fields.Name;
    return (
      itemClass?.kind === 'ref' &&
      itemClass.key === 'Wand' &&
      counts.en.get(englishName) === 1 &&
      counts.th.get(thaiName) === 1
    );
  });
  const base = eligible.find((row) => row.key.endsWith('/Wands/Wand1')) ?? eligible[0];
  if (!base || typeof base.fields.Name !== 'string') throw new Error('No verified wand base.');
  const thaiBase = thaiByKey.get(base.key);
  if (!thaiBase || typeof thaiBase.fields.Name !== 'string') {
    throw new Error('No canonical Thai label for the selected wand.');
  }
  const catalog = {
    descriptions,
    bases: itemBases,
  };

  function render(statId, value, locale) {
    for (const rule of descriptions) {
      if (rule.statIds.length !== 1 || rule.statIds[0] !== statId) continue;
      const result = renderStatGroup(
        { groupId: rule.groupId, statIds: rule.statIds, values: [value] },
        locale,
        catalog,
      );
      if (result.ok) return result.text;
    }
    throw new Error(`No supported client description: ${locale}/${statId}`);
  }
  const englishClipboard = [
    'Item Class: Wands',
    'Rarity: Rare',
    'Exile Engine Example',
    base.fields.Name,
    '--------',
    render('spell_damage_+%', 28, 'en'),
    render('base_cast_speed_+%', 10, 'en'),
  ].join('\n');
  const english = parseItemText(englishClipboard, catalog, {
    identity: reader.identity,
    locale: 'en',
    supportedStatIds: sparkWandStatIds,
  });
  if (!english.complete)
    throw new Error(`Unresolved English item: ${JSON.stringify(english.diagnostics)}`);
  const thaiLines = english.groups.map((group) => {
    if (!group.selected) throw new Error('An unresolved group must be reconciled explicitly.');
    const rendered = renderStatGroup(group.selected, 'th', catalog);
    if (!rendered.ok) throw new Error(rendered.reason);
    return rendered.text;
  });
  const thaiClipboard = [
    'ประเภทไอเทม: ไม้กายสิทธิ์',
    'ความหายาก: แรร์',
    'ตัวอย่าง Exile Engine',
    thaiBase.fields.Name,
    '--------',
    ...thaiLines,
  ].join('\n');
  const thai = parseItemText(thaiClipboard, catalog, {
    identity: reader.identity,
    locale: 'th',
    supportedStatIds: sparkWandStatIds,
  });
  if (!thai.complete) throw new Error(`Unresolved Thai item: ${JSON.stringify(thai.diagnostics)}`);
  const statValues = (item) => item.modifiers.map(({ statId, value }) => ({ statId, value }));
  if (JSON.stringify(statValues(english)) !== JSON.stringify(statValues(thai))) {
    throw new Error('Locale reconciliation changed canonical stat values.');
  }
  if (english.baseCandidates[0]?.id !== thai.baseCandidates[0]?.id) {
    throw new Error('Locale reconciliation changed canonical item identity.');
  }
  const dataset = requireValue(await rules.loadSparkDataset(reader), 'Spark loading');
  const calculate = (item) =>
    requireValue(
      rules.calculateSpark(
        {
          identity: reader.identity,
          gemLevel: 20,
          quality: 20,
          modifiers: item.modifiers,
          effectiveLightningResistancePercent: 0,
        },
        dataset,
      ),
      'Spark calculation',
    );
  const calculation = calculate(english);
  const thaiCalculation = calculate(thai);
  if (
    JSON.stringify(calculation.nonCriticalHitAfterResistance) !==
    JSON.stringify(thaiCalculation.nonCriticalHitAfterResistance)
  ) {
    throw new Error('Locale changed the calculated damage.');
  }
  const result = {
    game,
    identity: reader.identity,
    source: 'Constructed clipboard example using verified client base labels and SD templates.',
    englishClipboard,
    thaiClipboard,
    baseId: base.key,
    canonicalStats: statValues(english),
    calculation,
    localeRoundTrip: true,
  };
  reader.clearCache();
  return result;
}
