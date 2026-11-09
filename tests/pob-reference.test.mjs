import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadCatalog } from '@exile-engine/data-poe1';
import { importPobXml } from '@exile-engine/pob';
import {
  calculateSelectedSkill,
  createSelectedSkillSession,
  loadSparkDataset,
  selectedSkillEngineRevision,
} from '@exile-engine/poe1';

const reference = JSON.parse(
  await readFile(new URL('./fixtures/pob-reference.json', import.meta.url), 'utf8'),
);
const oracle = JSON.parse(
  await readFile(new URL('./fixtures/pob-oracle-output.json', import.meta.url), 'utf8'),
);
const snapshot = new URL('../packages/data-poe1/snapshot/', import.meta.url);
const reader = await loadCatalog((relative) => readFile(new URL(relative, snapshot)));
const loaded = await loadSparkDataset(reader);
assert.equal(loaded.ok, true, JSON.stringify(loaded.diagnostics));
const dataset = loaded.value;

function close(actual, expected, label) {
  assert.ok(Number.isFinite(actual), `${label}: nonfinite result`);
  const tolerance = reference.absoluteTolerance + reference.relativeTolerance * Math.abs(expected);
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected} (tolerance ${tolerance})`,
  );
}

function range(actual, expected, label) {
  for (const key of ['min', 'max', 'mean']) close(actual[key], expected[key], `${label}.${key}`);
}

test('reference records the executed pinned PoB oracle and separately reviewed arithmetic', async () => {
  assert.equal(reference.comparisonKind, 'executed-pinned-pob-headless');
  assert.equal(reference.pobExecuted, true);
  assert.equal(reference.engine.rulesRevision, selectedSkillEngineRevision);
  assert.match(reference.engine.repositoryRevision, /^[0-9a-f]{40}$/);
  assert.match(reference.reference.revision, /^[0-9a-f]{40}$/);
  assert.deepEqual(reader.identity, reference.identity);
  assert.ok(reference.reference.sources.every((entry) => /^[0-9a-f]{40}$/.test(entry.gitBlob)));
  assert.equal(reference.oracle.runtime.gitRevision, reference.reference.revision);
  assert.equal(reference.oracle.runtime.sourceChanges, false);
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  assert.equal(
    digest(await readFile(new URL('./fixtures/pob-oracle-output.json', import.meta.url))),
    reference.oracle.outputSha256,
  );
  for (const [path, expected] of Object.entries(reference.engine.sourceSha256)) {
    assert.equal(digest(await readFile(new URL(`../${path}`, import.meta.url))), expected, path);
  }
});

test('pinned PoB coefficient arithmetic independently resolves the same client base damage', () => {
  const b = reference.base;
  const requirement = b.levelRequirement - 1;
  const effectiveness =
    (b.baseDamageConstant + b.incrementalDamageConstant * requirement) *
    b.baseEffectiveness *
    (1 + b.incrementalEffectiveness) ** requirement;
  // Reviewed expression: CalcTools.lua:200-214. No engine calculation helper supplies these values.
  assert.equal(Math.floor(effectiveness * b.minimumCoefficient + 0.5), b.minimum);
  assert.equal(Math.floor(effectiveness * b.maximumCoefficient + 0.5), b.maximum);
  assert.equal(
    dataset.levels.find((level) => level.gemLevel === b.gemLevel).baseLightningMin,
    b.minimum,
  );
  assert.equal(
    dataset.levels.find((level) => level.gemLevel === b.gemLevel).baseLightningMax,
    b.maximum,
  );
});

test('added damage effectiveness is normalized from the exact client field and source rows', async () => {
  const fact = reference.base.addedDamageEffectiveness;
  close(fact.rawValue / fact.divisor + fact.offset, fact.value, 'effectiveness normalization');
  for (const source of fact.sourceRows) {
    const row = await reader.getRecord(fact.sourceTable, source.key);
    assert.equal(row.rowIndex, source.rowIndex);
    assert.equal(row.fields.StatSet.key, 'Spark');
    assert.equal(row.fields.GemLevel, source.gemLevel);
    assert.equal(row.fields[fact.sourceField], fact.rawValue);
    close(
      dataset.levels.find((level) => level.gemLevel === source.gemLevel).addedDamageEffectiveness,
      fact.value,
      `level ${source.gemLevel} effectiveness`,
    );
  }
});

test('Controlled Destruction facts and eligibility resolve from the same client snapshot', async () => {
  const fact = reference.supportReference;
  const effect = await reader.getRecord('GrantedEffects', fact.id);
  const statSet = await reader.resolve(effect.fields.StatSet1);
  const active = await reader.getRecord('ActiveSkills', 'spark');
  assert.equal(effect.rowIndex, fact.sourceRows.grantedEffect.rowIndex);
  assert.equal(effect.fields.IsSupport, true);
  assert.equal(statSet.rowIndex, fact.sourceRows.statSet.rowIndex);
  assert.deepEqual(
    statSet.fields.ConstantStats.map((stat) => stat.key),
    [fact.criticalChanceStatId],
  );
  assert.deepEqual(statSet.fields.ConstantStatsValues, [fact.criticalChancePercent]);
  assert.deepEqual(effect.fields.ExcludedActiveSkillTypes, []);
  const allowed = effect.fields.AllowedActiveSkillTypes.map((type) => type.key);
  assert.ok(active.fields.ActiveSkillTypes.some((type) => allowed.includes(type.key)));
  const normalized = dataset.supports.find((support) => support.id === fact.id);
  assert.deepEqual(normalized.identity, reference.identity);
  assert.equal(normalized.gemId, fact.gameItemId);
  assert.equal(normalized.levels.length, 20);
  const rawStats = await reader.getTable('GrantedEffectStatSetsPerLevel');
  const rawEffects = await reader.getTable('GrantedEffectsPerLevel');
  for (const [index, expected] of fact.moreSpellDamageByLevel.entries()) {
    const gemLevel = index + 1;
    const raw = rawStats.find(
      (row) => row.fields.StatSet?.key === fact.id && row.fields.GemLevel === gemLevel,
    );
    const perEffect = rawEffects.find(
      (row) => row.fields.GrantedEffect?.key === fact.id && row.fields.Level === gemLevel,
    );
    assert.deepEqual(
      raw.fields.AdditionalStats.map((stat) => stat.key),
      [fact.spellDamageStatId],
    );
    assert.deepEqual(raw.fields.AdditionalStatsValues, [expected]);
    assert.equal(perEffect.fields.CostMultiplier, fact.costMultiplierSource);
    const level = normalized.levels.find((level) => level.gemLevel === gemLevel);
    assert.equal(level.moreSpellDamagePercent, expected);
    assert.equal(level.criticalStrikeChancePercent, fact.criticalChancePercent);
    close(level.manaCostMultiplier, fact.manaCostMultiplier, 'support cost multiplier');
    assert.ok(
      level.sourceRows.some(
        (row) =>
          row.table === 'GrantedEffectStatSetsPerLevel' &&
          row.key === raw.key &&
          row.rowIndex === raw.rowIndex,
      ),
    );
  }
});

for (const expected of reference.cases) {
  test(`${expected.fixture}: adapted XML intermediates, contributions and selected hit/combined DPS match executed pinned PoB`, async () => {
    const xml = await readFile(
      new URL(`./fixtures/pob/${expected.fixture}.xml`, import.meta.url),
      'utf8',
    );
    assert.equal(createHash('sha256').update(xml).digest('hex'), expected.xmlSha256);
    const imported = importPobXml({
      format: 'pob-xml',
      xml,
      target: reader.identity,
      buildId: `fixture:${expected.fixture}`,
      configurationId: `fixture:${expected.fixture}:enemy`,
    });
    assert.equal(imported.complete, true, JSON.stringify(imported.diagnostics));
    assert.deepEqual(imported.unresolved, []);
    const result = calculateSelectedSkill(imported.selectedSkill, dataset);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const value = result.value;
    const session = createSelectedSkillSession(imported.selectedSkill, dataset);
    assert.equal(session.ok, true, JSON.stringify(session.diagnostics));
    assert.deepEqual(session.value.current.calculation, value);
    const unchanged = session.value.recalculate(imported.selectedSkill);
    assert.equal(unchanged.ok, true, JSON.stringify(unchanged.diagnostics));
    assert.deepEqual(unchanged.value.calculation, value);
    assert.deepEqual(unchanged.value.recalculated, []);
    assert.deepEqual(value.identity, reference.identity);
    assert.equal(value.buildId, `fixture:${expected.fixture}`);
    assert.equal(value.configuration.id, `fixture:${expected.fixture}:enemy`);
    assert.equal(value.metric, reference.metric);
    assert.equal(value.engineRevision, reference.engine.rulesRevision);
    assert.equal(value.hitsPerCast, 1);
    assert.deepEqual(value.includedDamage, ['lightning-hit']);
    assert.equal(value.skill.id, 'Spark');
    assert.equal(value.skill.gemLevel, expected.gemLevel);
    assert.deepEqual(value.skill.supports ?? [], expected.supports);
    const supportEffects = value.supportEffects;
    assert.deepEqual(supportEffects.supports, expected.supports);
    for (const key of [
      'spellDamageMultiplier',
      'criticalChanceMultiplier',
      'castTimeMultiplier',
      'manaCostMultiplier',
    ])
      close(supportEffects[key], expected[key], key);
    assert.equal(supportEffects.castTimeMultiplier, 1);
    assert.deepEqual(
      supportEffects.contributions.map(({ statId, value, operation, appliedToSelectedHit }) => ({
        statId,
        value,
        operation,
        appliedToSelectedHit,
      })),
      expected.supportContributions,
    );
    for (const contribution of supportEffects.contributions) {
      assert.deepEqual(contribution.source, expected.supports[0].source);
      assert.equal(contribution.scope, 'global');
      assert.ok(
        contribution.sourceRows.some(
          (row) =>
            row.table === 'GrantedEffectStatSets' && row.key === reference.supportReference.id,
        ),
      );
      assert.ok(
        contribution.sourceRows.some(
          (row) => row.table === 'Stats' && row.key === contribution.statId,
        ),
      );
    }
    const hit = value.hit;
    assert.deepEqual(
      hit.modifierContributions.map(({ statId, value }) => ({ statId, value })),
      expected.contributions,
    );
    assert.ok(
      hit.modifierContributions.every(
        (entry) =>
          entry.source.kind === 'item' &&
          entry.source.id &&
          Number.isSafeInteger(entry.source.line),
      ),
    );
    assert.equal(
      new Set(hit.modifierContributions.map((entry) => `${entry.source.id}:${entry.source.line}`))
        .size,
      expected.contributions.length,
    );
    range(hit.baseLightningDamage, expected.baseLightningDamage, 'intrinsic base');
    const added = value.addedLightningDamage;
    range(added.raw, expected.rawAddedLightningDamage, 'raw added');
    close(added.effectiveness, expected.addedDamageEffectiveness, 'added effectiveness');
    range(added.effective, expected.effectiveAddedLightningDamage, 'effective added');
    range(added.combinedBase, expected.combinedBaseLightningDamage, 'combined base');
    assert.deepEqual(
      added.contributions.map(({ statIds, values, source }) => ({
        statIds,
        values,
        source: { kind: source.kind, id: source.id, line: source.line },
      })),
      expected.addedGroups,
    );
    assert.deepEqual(imported.addedLightningDamage, added.contributions);
    assert.equal(
      new Set(added.contributions.map((entry) => `${entry.source.id}:${entry.source.line}`)).size,
      expected.addedGroups.length,
    );
    range(hit.nonCriticalHitBeforeResistance, expected.beforeResistance, 'beforeResistance');
    range(hit.nonCriticalHitAfterResistance, expected.afterResistance, 'afterResistance');
    for (const key of [
      'increasedDamagePercent',
      'increasedCastSpeedPercent',
      'effectiveLightningResistancePercent',
      'castTimeSeconds',
      'castsPerSecond',
    ])
      close(hit[key], expected[key], key);
    close(value.hitsPerSecond, expected.castsPerSecond, 'one hit per cast');
    close(value.hitDps, expected.hitDps, 'hitDps');
    close(value.combinedDps, expected.combinedDps, 'combinedDps');
    // Independent evaluation of the reviewed PoB branches, including their rounding boundaries.
    const damageIncrease = expected.contributions
      .filter((mod) => mod.statId !== 'base_cast_speed_+%')
      .reduce((sum, mod) => sum + mod.value, 0);
    const castIncrease = expected.contributions
      .filter((mod) => mod.statId === 'base_cast_speed_+%')
      .reduce((sum, mod) => sum + mod.value, 0);
    const addedMinimum = expected.addedGroups.reduce((sum, group) => sum + group.values[0], 0);
    const addedMaximum = expected.addedGroups.reduce((sum, group) => sum + group.values[1], 0);
    const minimum = Math.floor(
      (expected.baseLightningDamage.min + addedMinimum * expected.addedDamageEffectiveness) *
        (1 + damageIncrease / 100) *
        expected.spellDamageMultiplier +
        0.5,
    );
    const maximum = Math.floor(
      (expected.baseLightningDamage.max + addedMaximum * expected.addedDamageEffectiveness) *
        (1 + damageIncrease / 100) *
        expected.spellDamageMultiplier +
        0.5,
    );
    const speed = Math.min(
      Math.floor((1 + castIncrease / 100) * 100 + 0.5) / 100 / reference.base.castTimeSeconds,
      1 / 0.033,
    );
    const dps =
      ((minimum + maximum) / 2) * (1 - expected.effectiveLightningResistancePercent / 100) * speed;
    close(value.combinedDps, dps, 'independent pinned-source CombinedDPS branch');
    const observed = oracle[expected.fixture];
    assert.equal(observed.selectedSkillId, 'Spark');
    assert.equal(observed.selectedPart, 1);
    assert.equal(observed.CritChance, 0);
    assert.equal(observed.HitChance, 100);
    assert.equal(observed.ActionSpeedMod, 1);
    close(
      supportEffects.spellDamageMultiplier,
      observed.supportDamageMultiplier,
      'PoB support damage multiplier',
    );
    close(
      supportEffects.criticalChanceMultiplier,
      observed.supportCriticalChanceMultiplier,
      'PoB support crit chance multiplier',
    );
    close(
      supportEffects.manaCostMultiplier,
      observed.supportManaCostMultiplier,
      'PoB support mana cost multiplier',
    );
    assert.equal(observed.supportSpeedMultiplier, 1);
    assert.equal(observed.supportTotalCastTime, 0);
    assert.deepEqual(
      observed.supportGems.map((gem) => ({
        id: gem.skillId,
        gemLevel: gem.level,
        quality: gem.quality,
        enabled: gem.enabled,
      })),
      expected.supports.map(({ source, ...support }) => support),
    );
    for (const gem of observed.supportGems) {
      assert.equal(gem.gameId, reference.supportReference.gameItemId);
      assert.equal(gem.gemId, reference.supportReference.pobGemKey);
      assert.equal(gem.nameSpec, reference.supportReference.name);
    }
    const supportEnabled = expected.supports[0]?.enabled === true;
    const observedSupportMods = observed.supportContributions.map(
      ({ name, value, flags, keywordFlags, source }) => {
        assert.equal(source, `Skill:${reference.supportReference.id}`);
        return { name, value, flags, keywordFlags };
      },
    );
    assert.deepEqual(
      observedSupportMods,
      supportEnabled
        ? [
            {
              name: 'Damage',
              value: expected.supportContributions[0].value,
              flags: 2,
              keywordFlags: 0,
            },
            {
              name: 'CritChance',
              value: reference.supportReference.criticalChancePercent,
              flags: 0,
              keywordFlags: 0,
            },
            {
              name: 'SupportManaMultiplier',
              value: reference.supportReference.costMultiplierSource - 100,
              flags: 0,
              keywordFlags: 0,
            },
          ]
        : [],
    );
    close(added.raw.min, observed.addedMinimum, 'PoB added minimum');
    close(added.raw.max, observed.addedMaximum, 'PoB added maximum');
    close(added.effectiveness, observed.damageEffectiveness, 'PoB added effectiveness');
    close(added.combinedBase.min, observed.LightningMinBase, 'PoB combined base minimum');
    close(added.combinedBase.max, observed.LightningMaxBase, 'PoB combined base maximum');
    close(hit.nonCriticalHitAfterResistance.min, observed.TotalMin, 'PoB effective minimum');
    close(hit.nonCriticalHitAfterResistance.max, observed.TotalMax, 'PoB effective maximum');
    close(
      hit.nonCriticalHitAfterResistance.mean,
      observed.LightningHitAverage,
      'PoB mean lightning hit',
    );
    close(hit.nonCriticalHitAfterResistance.mean, observed.AverageHit, 'PoB AverageHit');
    close(hit.nonCriticalHitAfterResistance.mean, observed.AverageDamage, 'PoB AverageDamage');
    close(
      hit.increasedDamagePercent,
      observed.increasedDamagePercent,
      'PoB applicable damage total',
    );
    close(
      hit.increasedCastSpeedPercent,
      observed.increasedCastSpeedPercent,
      'PoB applicable cast total',
    );
    close(hit.castsPerSecond, observed.Speed, 'PoB Speed');
    close(hit.castTimeSeconds, observed.Time, 'PoB Time');
    close(value.hitDps, observed.TotalDPS, 'PoB selected-skill TotalDPS');
    close(value.combinedDps, observed.CombinedDPS, 'PoB selected-skill CombinedDPS');
    const damageRows = observed.lightningBreakdown.damageTypes;
    assert.equal(damageRows.length, 1);
    assert.equal(damageRows[0].source, 'Lightning');
    assert.equal(
      damageRows[0].total,
      `${expected.beforeResistance.min} to ${expected.beforeResistance.max}`,
    );
    // This comparison-only map is deliberately explicit. PoB names never enter engine inputs.
    const canonical = new Map([
      ['Damage:0:0', 'damage_+%'],
      ['Damage:2:0', 'spell_damage_+%'],
      ['Damage:1024:0', 'projectile_damage_+%'],
      ['LightningDamage:0:0', 'lightning_damage_+%'],
      ['Speed:16:0', 'base_cast_speed_+%'],
    ]);
    const compared = observed.contributions.map((entry) => {
      const statId = canonical.get(`${entry.name}:${entry.flags}:${entry.keywordFlags}`);
      assert.ok(statId, `Unreviewed PoB modifier mapping: ${entry.name}`);
      assert.equal(entry.source, 'Item:1:Synthetic Spark Fixture, Simple Robe');
      return { statId, value: entry.value };
    });
    const sorted = (entries) =>
      entries.toSorted(
        (left, right) => left.statId.localeCompare(right.statId) || left.value - right.value,
      );
    assert.deepEqual(sorted(compared), sorted(expected.contributions));
    const flatIds = [
      'spell_minimum_added_lightning_damage',
      'spell_maximum_added_lightning_damage',
    ];
    const flatMapping = new Map([
      ['LightningMin:0:131072', flatIds[0]],
      ['LightningMax:0:131072', flatIds[1]],
    ]);
    const observedAdded = observed.addedContributions.map((entry) => {
      const statId = flatMapping.get(`${entry.name}:${entry.flags}:${entry.keywordFlags}`);
      assert.ok(statId, `Unreviewed PoB added modifier ${entry.name}`);
      assert.equal(entry.source, 'Item:1:Synthetic Spark Fixture, Simple Robe');
      return { statId, value: entry.value };
    });
    // PoB Tabulate omits zero-value entries; the parsed item line still retains both endpoints.
    const flattened = expected.addedGroups.flatMap((group) =>
      group.values.map((value, index) => ({ statId: group.statIds[index], value })),
    );
    assert.deepEqual(sorted(observedAdded), sorted(flattened.filter((entry) => entry.value !== 0)));
    const observedLines = observed.itemModifierLines.filter((row) =>
      row.mods.some((mod) => mod.keywordFlags === 131072),
    );
    assert.deepEqual(
      observedLines.map((row) =>
        row.mods.map((mod) => ({
          statId: flatMapping.get(`${mod.name}:${mod.flags}:${mod.keywordFlags}`),
          value: mod.value,
        })),
      ),
      expected.addedGroups.map((group) =>
        group.values.map((value, index) => ({ statId: group.statIds[index], value })),
      ),
    );
    for (const [index, group] of expected.addedGroups.entries()) {
      const line = `Adds ${group.values[0]} to ${group.values[1]} Lightning Damage to Spells`;
      assert.equal(observedLines[index].line, line);
      assert.equal(added.contributions[index].source.label, line);
    }
  });
}

for (const rejection of reference.rejectedFixtures) {
  const fixture = rejection.fixture;
  test(`${fixture}: rejected XML has no selected-skill calculation input`, async () => {
    const xml = await readFile(new URL(`./fixtures/pob/${fixture}.xml`, import.meta.url), 'utf8');
    assert.equal(createHash('sha256').update(xml).digest('hex'), rejection.xmlSha256);
    assert.equal(rejection.oracleExecuted, false);
    const imported = importPobXml({
      format: 'pob-xml',
      xml,
      target: reader.identity,
      buildId: fixture,
      configurationId: 'explicit',
    });
    assert.equal(imported.complete, false);
    assert.equal(imported.selectedSkill, undefined);
    assert.ok(imported.diagnostics.some((entry) => entry.severity === 'error'));
    assert.ok(imported.unresolved.length > 0);
  });
}
