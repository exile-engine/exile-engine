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
const probes = JSON.parse(
  await readFile(new URL('./fixtures/pob-oracle-probes.json', import.meta.url), 'utf8'),
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
  assert.equal(
    digest(await readFile(new URL('./fixtures/pob-oracle-probes.json', import.meta.url))),
    reference.oracle.parserProbeSha256,
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

test('Faster Casting joins exact gem, eligibility, cast-speed and per-level cost rows', async () => {
  const fact = reference.fasterCastingReference;
  const effect = await reader.getRecord('GrantedEffects', fact.id);
  const statSet = await reader.resolve(effect.fields.StatSet1);
  assert.equal(effect.rowIndex, fact.sourceRows.grantedEffect.rowIndex);
  assert.equal(statSet.rowIndex, fact.sourceRows.statSet.rowIndex);
  assert.equal(effect.fields.IsSupport, true);
  assert.equal(effect.fields.CastTime, 1000);
  assert.deepEqual(statSet.fields.ConstantStats, []);
  assert.deepEqual(statSet.fields.ConstantStatsValues, []);
  assert.deepEqual(
    effect.fields.AllowedActiveSkillTypes.map((type) => type.key),
    fact.allowedSkillTypes,
  );
  assert.deepEqual(
    effect.fields.ExcludedActiveSkillTypes.map((type) => type.key),
    fact.excludedSkillTypes,
  );
  const active = await reader.getRecord('ActiveSkills', 'spark');
  const types = active.fields.ActiveSkillTypes.map((type) => type.key);
  assert.ok(fact.allowedSkillTypes.some((type) => types.includes(type)));
  assert.ok(fact.excludedSkillTypes.every((type) => !types.includes(type)));
  const gem = await reader.getRecord('SkillGems', fact.sourceRows.skillGem.key);
  const variant = await reader.resolve(gem.fields.GemVariants[0]);
  assert.equal(gem.rowIndex, fact.sourceRows.skillGem.rowIndex);
  assert.equal(gem.fields.BaseItemTypesKey.key, fact.gameItemId);
  assert.equal(gem.fields.BaseItemTypesKey.rowIndex, fact.sourceRows.baseItem.rowIndex);
  assert.equal(variant.rowIndex, fact.sourceRows.gemEffect.rowIndex);
  assert.equal(variant.fields.GrantedEffect.key, fact.id);
  const normalized = dataset.supports.find((support) => support.id === fact.id);
  assert.deepEqual(normalized.identity, reference.identity);
  assert.equal(normalized.gemId, fact.gameItemId);
  assert.equal(normalized.levels.length, 20);
  const rawStats = await reader.getTable('GrantedEffectStatSetsPerLevel');
  const rawEffects = await reader.getTable('GrantedEffectsPerLevel');
  for (const [index, expected] of fact.increasedCastSpeedByLevel.entries()) {
    const gemLevel = index + 1;
    const raw = rawStats.find(
      (row) => row.fields.StatSet?.key === fact.id && row.fields.GemLevel === gemLevel,
    );
    const perEffect = rawEffects.find(
      (row) => row.fields.GrantedEffect?.key === fact.id && row.fields.Level === gemLevel,
    );
    assert.deepEqual(
      raw.fields.AdditionalStats.map((stat) => stat.key),
      [fact.castSpeedStatId],
    );
    assert.equal(raw.fields.AdditionalStats[0].rowIndex, fact.sourceRows.stat.rowIndex);
    assert.deepEqual(raw.fields.AdditionalStatsValues, [expected]);
    assert.equal(perEffect.fields.CostMultiplier, fact.costMultiplierSource);
    const level = normalized.levels.find((level) => level.gemLevel === gemLevel);
    assert.equal(level.increasedCastSpeedPercent, expected);
    close(level.manaCostMultiplier, fact.manaCostMultiplier, 'Faster Casting cost multiplier');
    for (const source of [
      { table: 'GrantedEffectStatSetsPerLevel', ...raw },
      { table: 'GrantedEffectsPerLevel', ...perEffect },
    ])
      assert.ok(
        level.sourceRows.some(
          (row) =>
            row.table === source.table &&
            row.key === source.key &&
            row.rowIndex === source.rowIndex,
        ),
      );
  }
});

test('executed fractional item-text probe remains a rejected import rather than silently changing a contribution', () => {
  assert.equal(probes.pobExecuted, true);
  assert.equal(probes.referenceRevision, reference.reference.revision);
  assert.equal(probes.probes.length, 1);
  const probe = probes.probes[0];
  assert.equal(createHash('sha256').update(probe.inputXml).digest('hex'), probe.inputXmlSha256);
  assert.equal(probe.observed.sourceXmlSha256, probe.inputXmlSha256);
  assert.ok(probe.inputXml.includes(probe.authoredLine));
  assert.equal(probe.authoredLine, '12.34% increased Cast Speed');
  assert.equal(probe.nativeParsedItemValue, 12);
  assert.deepEqual(probe.observed.itemModifierLines[0], {
    line: probe.authoredLine,
    mods: [{ name: 'Speed', value: 12, flags: 16, keywordFlags: 0 }],
  });
  assert.equal(probe.observed.increasedCastSpeedPercent, 51);
  const imported = importPobXml({
    format: 'pob-xml',
    xml: probe.inputXml,
    target: reader.identity,
    buildId: 'probe:fractional-item-cast-speed',
    configurationId: 'probe:fractional-item-cast-speed:enemy',
  });
  assert.equal(imported.complete, false);
  assert.equal(imported.selectedSkill, undefined);
  assert.ok(imported.unresolved.length > 0);
  assert.ok(imported.diagnostics.length > 0);
});

test('critical chance uses client rows while the base player multiplier keeps external rule provenance', async () => {
  const fact = reference.criticalReference;
  assert.equal(dataset.critical.baseMultiplierPercent, fact.baseMultiplierPercent);
  assert.deepEqual(dataset.critical.baseMultiplierSource, fact.baseMultiplierSource);
  assert.deepEqual(dataset.critical.identity, reference.identity);
  assert.deepEqual(dataset.critical.sourceRows, fact.statRows);
  for (const source of fact.statRows) {
    const row = await reader.getRecord(source.table, source.key);
    assert.equal(row.rowIndex, source.rowIndex);
    assert.equal(row.fields.Id, source.key);
    assert.equal(row.fields.IsLocal, false);
    assert.equal(row.fields.IsWeaponLocal, false);
  }
  for (const source of fact.baseChanceSource.sourceRows) {
    const row = await reader.getRecord(fact.baseChanceSource.table, source.key);
    assert.equal(row.fields[fact.baseChanceSource.field], fact.baseChanceSource.rawValue);
    close(
      dataset.levels.find((level) => level.gemLevel === source.gemLevel)
        .baseCriticalStrikeChancePercent,
      fact.baseChanceSource.valuePercent,
      'client critical chance',
    );
  }
});

test('penetration and exposure keep exact stat identities and negative authored exposure values', async () => {
  const fact = reference.resistanceReference;
  assert.deepEqual(dataset.resistance.identity, reference.identity);
  assert.deepEqual(dataset.resistance.ruleSource, fact.ruleSource);
  assert.deepEqual(dataset.resistance.sourceRows, fact.statRows);
  for (const source of fact.statRows) {
    const row = await reader.getRecord(source.table, source.key);
    assert.equal(row.rowIndex, source.rowIndex);
    assert.equal(row.fields.Id, source.key);
    assert.equal(row.fields.IsLocal, false);
    assert.equal(row.fields.IsWeaponLocal, false);
  }
  const example = fact.exposureSourceExample;
  const row = await reader.getRecord(example.table, example.key);
  assert.equal(row.rowIndex, example.rowIndex);
  assert.equal(row.fields.StatsKey1.key, example.statId);
  assert.equal(row.fields.Stat1Min, example.value);
  assert.equal(row.fields.Stat1Max, example.value);
});

test('configured shock preserves the matching game vocabulary and separate scenario rule source', async () => {
  const fact = reference.shockReference;
  assert.deepEqual(dataset.shock.identity, reference.identity);
  assert.deepEqual(dataset.shock.ruleSource, fact.ruleSource);
  assert.deepEqual(dataset.shock.sourceRows, fact.statRows);
  assert.deepEqual(
    Object.keys(oracle).toSorted(),
    reference.cases.map((entry) => entry.fixture).toSorted(),
  );
  for (const source of fact.statRows) {
    const row = await reader.getRecord(source.table, source.key);
    assert.equal(row.rowIndex, source.rowIndex);
    assert.equal(row.fields.Id, source.key);
    assert.equal(row.fields.IsLocal, false);
    assert.equal(row.fields.IsWeaponLocal, false);
  }
});

for (const expected of reference.cases) {
  test(`${expected.fixture}: adapted XML intermediates, contributions and selected hit/combined DPS match ${expected.shock ? 'host-weighted executed pinned PoB endpoints' : 'executed pinned PoB'}`, async () => {
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
      ...(expected.shock ? { shockUptimePercent: expected.shock.uptimePercent } : {}),
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
    assert.equal(value.configuration.effectiveLightningResistancePercent, undefined);
    const rawResistance = value.configuration.lightningResistance;
    assert.equal(rawResistance.baseResistancePercent, expected.rawResistancePercent);
    assert.equal(rawResistance.maximumResistanceMode, expected.maximumResistanceMode);
    assert.deepEqual(rawResistance.exposures, expected.exposures);
    assert.deepEqual(rawResistance.source, {
      kind: 'scenario',
      id: 'pob-config:enemyLightningResist',
      label: `enemyLightningResist=${expected.rawResistancePercent}`,
    });
    const resistance = value.resistanceEffects;
    for (const [key, wanted] of Object.entries(expected.resistanceEffects)) {
      if (typeof wanted === 'number') close(resistance[key], wanted, `resistance.${key}`);
      else assert.deepEqual(resistance[key], wanted, `resistance.${key}`);
    }
    assert.deepEqual(resistance.ruleSource, reference.resistanceReference.ruleSource);
    assert.deepEqual(resistance.sourceRows, reference.resistanceReference.statRows);
    assert.deepEqual(resistance.configurationSource, rawResistance.source);
    assert.deepEqual(resistance.exposureContributions, expected.exposures);
    assert.deepEqual(
      resistance.penetrationContributions.map(({ statId, value, source }) => ({
        statId,
        value,
        source: { kind: source.kind, id: source.id, line: source.line },
      })),
      expected.penetrationModifiers.map(({ statId, value, line }) => ({
        statId,
        value,
        source: { kind: 'item', id: 'pob-item:1', line },
      })),
    );
    assert.equal(value.configuration.criticalStrikeMode ?? 'disabled', expected.criticalMode);
    assert.deepEqual(value.configuration.shock, expected.shock);
    if (expected.shock) assert.equal(value.configuration.ailmentMode, 'configured-shock');
    else if (expected.criticalMode === 'average')
      assert.equal(value.configuration.ailmentMode, 'excluded');
    const critical = value.criticalEffects;
    const shock = value.shockEffects;
    assert.equal(shock.mode, expected.shock ? 'configured' : 'excluded');
    for (const [key, wanted] of Object.entries(expected.shockEffects))
      if (typeof wanted === 'number') close(shock[key], wanted, `shock.${key}`);
      else assert.deepEqual(shock[key], wanted, `shock.${key}`);
    assert.deepEqual(shock.ruleSource, reference.shockReference.ruleSource);
    assert.deepEqual(shock.sourceRows, reference.shockReference.statRows);
    assert.deepEqual(
      shock.contributions,
      expected.shock
        ? [
            {
              statId: reference.shockReference.statRows[0].key,
              value: expected.shock.magnitudePercent,
              uptimePercent: expected.shock.uptimePercent,
              operation: 'increased-damage-taken',
              source: expected.shock.source,
            },
          ]
        : [],
    );
    assert.equal(critical.mode, expected.criticalMode);
    for (const [key, wanted] of Object.entries(expected.criticalEffects)) {
      if (key === 'mode') continue;
      if (typeof wanted === 'number') close(critical[key], wanted, `critical.${key}`);
      else range(critical[key], wanted, `critical.${key}`);
    }
    assert.deepEqual(
      critical.baseMultiplierSource,
      reference.criticalReference.baseMultiplierSource,
    );
    assert.deepEqual(
      critical.modifierContributions.map(({ statId, value }) => ({ statId, value })),
      expected.criticalModifiers.map(({ statId, value }) => ({ statId, value })),
    );
    assert.deepEqual(
      critical.modifierContributions.map((mod) => ({
        kind: mod.source.kind,
        id: mod.source.id,
        line: mod.source.line,
      })),
      expected.criticalModifiers.map((mod) => ({ kind: 'item', id: 'pob-item:1', line: mod.line })),
    );
    for (const source of reference.criticalReference.statRows)
      assert.ok(
        critical.sourceRows.some(
          (row) =>
            row.table === source.table &&
            row.key === source.key &&
            row.rowIndex === source.rowIndex,
        ),
      );
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
    close(
      supportEffects.increasedCastSpeedPercent,
      expected.supportIncreasedCastSpeedPercent,
      'support-only increased cast speed',
    );
    assert.equal(supportEffects.castTimeMultiplier, 1);
    assert.deepEqual(
      supportEffects.contributions.map(
        ({ statId, value, operation, appliedToSelectedHit, appliedToCastRate }) => ({
          statId,
          value,
          operation,
          appliedToSelectedHit,
          appliedToCastRate,
        }),
      ),
      expected.supportContributions,
    );
    for (const contribution of supportEffects.contributions) {
      const supportId =
        contribution.statId === reference.fasterCastingReference.castSpeedStatId
          ? reference.fasterCastingReference.id
          : reference.supportReference.id;
      const selected = expected.supports.find((support) => support.id === supportId);
      assert.ok(selected, `support source for ${contribution.statId}`);
      assert.deepEqual(contribution.source, selected.source);
      assert.equal(contribution.scope, 'global');
      assert.ok(
        contribution.sourceRows.some(
          (row) => row.table === 'GrantedEffectStatSets' && row.key === supportId,
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
      .reduce((sum, mod) => sum + mod.value, expected.supportIncreasedCastSpeedPercent);
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
    const refChanceIncrease = expected.criticalModifiers
      .filter((mod) => mod.statId !== 'base_critical_strike_multiplier_+')
      .reduce((sum, mod) => sum + mod.value, 0);
    const refMultiplierAddition = expected.criticalModifiers
      .filter((mod) => mod.statId === 'base_critical_strike_multiplier_+')
      .reduce((sum, mod) => sum + mod.value, 0);
    const refChance =
      expected.criticalMode === 'average'
        ? Math.max(
            0,
            Math.min(
              100,
              Math.floor(
                reference.criticalReference.baseChanceSource.valuePercent *
                  (1 + refChanceIncrease / 100) *
                  expected.criticalChanceMultiplier *
                  100 +
                  0.5,
              ) / 100,
            ),
          )
        : 0;
    const refMultiplier =
      1 +
      Math.max(
        0,
        (reference.criticalReference.baseMultiplierPercent - 100 + refMultiplierAddition) / 100,
      );
    const nonCritMean = (minimum + maximum) / 2;
    const critMean = (minimum * refMultiplier) / 2 + (maximum * refMultiplier) / 2;
    const refExposure = Math.min(
      0,
      ...expected.exposures
        .filter((exposure) => exposure.enabled)
        .map((exposure) => exposure.value),
    );
    const refMaximum =
      expected.maximumResistanceMode === 'default75'
        ? reference.resistanceReference.constants.defaultMaximumPercent
        : Math.min(
            Math.max(
              expected.rawResistancePercent,
              reference.resistanceReference.constants.defaultMaximumPercent,
            ),
            reference.resistanceReference.constants.hardMaximumPercent,
          );
    const refPenetration = expected.penetrationModifiers.reduce((sum, mod) => sum + mod.value, 0);
    const refResistance =
      Math.max(
        reference.resistanceReference.constants.minimumPercent,
        Math.min(expected.rawResistancePercent + refExposure, refMaximum),
      ) - refPenetration;
    close(
      resistance.effectiveResistancePercent,
      refResistance,
      'independent exposure/cap/penetration stages',
    );
    const dps =
      (nonCritMean * (1 - refChance / 100) + (critMean * refChance) / 100) *
      (1 - refResistance / 100) *
      (1 +
        ((expected.shock?.magnitudePercent ?? 0) * (expected.shock?.uptimePercent ?? 0)) / 10000) *
      speed;
    close(value.combinedDps, dps, 'independent pinned-source CombinedDPS branch');
    const observedShocked = oracle[expected.fixture];
    const observed = observedShocked.unshocked ?? observedShocked;
    assert.equal(observedShocked.sourceXmlSha256, expected.xmlSha256);
    if (expected.shock) {
      assert.equal(expected.comparisonKind, 'host-weighted-executed-pob-endpoints');
      assert.equal(observedShocked.sourceXmlSha256, expected.oracleEndpoints.shockedXmlSha256);
      const unshockedXml = xml.replace(
        'name="conditionEnemyShocked" boolean="true"',
        'name="conditionEnemyShocked" boolean="false"',
      );
      assert.notEqual(unshockedXml, xml);
      assert.equal(
        createHash('sha256').update(unshockedXml).digest('hex'),
        expected.oracleEndpoints.unshockedXmlSha256,
      );
      assert.equal(observed.sourceXmlSha256, expected.oracleEndpoints.unshockedXmlSha256);
      assert.equal(observed.xmlTransformation, expected.oracleEndpoints.unshockedXmlTransformation);
      assert.equal(observedShocked.enemyShockConfigured, true);
      assert.equal(observed.enemyShockConfigured, false);
      close(
        observedShocked.configuredShockEffectPercent,
        expected.shock.magnitudePercent,
        'PoB configured shock magnitude',
      );
      close(
        observedShocked.CurrentShock,
        expected.shock.magnitudePercent,
        'PoB applied shock magnitude',
      );
      close(
        observedShocked.MaximumShock,
        reference.shockReference.maximumMagnitudePercent,
        'PoB default shock cap',
      );
      close(
        observedShocked.enemyDamageTakenPercent,
        expected.shock.magnitudePercent,
        'PoB shock damage taken total',
      );
      close(observed.CurrentShock, 0, 'PoB unshocked endpoint magnitude');
      close(observed.enemyDamageTakenPercent, 0, 'PoB unshocked endpoint damage taken');
      assert.deepEqual(
        observedShocked.shockContributions,
        expected.shock.magnitudePercent === 0
          ? []
          : [
              {
                name: 'DamageTaken',
                value: expected.shock.magnitudePercent,
                source: 'Shock',
                flags: 0,
                keywordFlags: 0,
              },
            ],
      );
      assert.deepEqual(observed.shockContributions, []);
      close(
        shock.unshockedHitMeanAfterResistance,
        observed.AverageHit,
        'executed unshocked endpoint hit mean',
      );
      close(
        shock.shockedHitMeanAfterResistance,
        observedShocked.AverageHit,
        'executed shocked endpoint hit mean',
      );
      const uptime = expected.shock.uptimePercent / 100;
      close(
        shock.expectedHitMeanAfterShock,
        observed.AverageHit * (1 - uptime) + observedShocked.AverageHit * uptime,
        'host-weighted executed endpoint expected hit',
      );
      close(
        shock.normalHitMeanAfterShock,
        observed.LightningHitAverage * (1 - uptime) + observedShocked.LightningHitAverage * uptime,
        'host-weighted normal hit',
      );
      if (expected.criticalMode === 'average')
        close(
          shock.criticalHitMeanAfterShock,
          observed.LightningCritAverage * (1 - uptime) +
            observedShocked.LightningCritAverage * uptime,
          'host-weighted critical hit',
        );
      for (const key of [
        'Speed',
        'Time',
        'CritChance',
        'CritMultiplier',
        'LightningMinBase',
        'LightningMaxBase',
        'addedMinimum',
        'addedMaximum',
        'increasedDamagePercent',
        'increasedCastSpeedPercent',
      ])
        assert.equal(observedShocked[key], observed[key], `shock leaves ${key} unchanged`);
      for (const key of [
        'contributions',
        'addedContributions',
        'supportContributions',
        'criticalContributions',
        'penetrationContributions',
        'enemyLightningResistanceContributions',
      ])
        assert.deepEqual(observedShocked[key], observed[key], `shock leaves ${key} unchanged`);
      if (observedShocked.lightningDamageMultiplier !== undefined)
        close(
          observedShocked.lightningDamageMultiplier,
          observed.lightningDamageMultiplier * shock.shockedDamageMultiplier,
          'PoB common resistance and shocked damage-taken multiplier',
        );
    } else {
      assert.equal(observed.CurrentShock, 0);
      assert.equal(observed.enemyDamageTakenPercent, 0);
      assert.deepEqual(observed.shockContributions, []);
    }
    assert.equal(observed.selectedSkillId, 'Spark');
    assert.equal(observed.selectedPart, 1);
    close(critical.chancePercent, observed.CritChance, 'PoB critical chance');
    if (expected.criticalMode === 'average') {
      close(critical.criticalMultiplier, observed.CritMultiplier, 'PoB critical multiplier');
      close(
        critical.criticalHitAfterResistance.mean,
        observed.LightningCritAverage,
        'PoB mean critical lightning hit',
      );
      assert.ok(Object.values(observed.ailmentFlags).every((value) => value === true));
    } else assert.equal(observed.CritChance, 0);
    close(
      critical.baseChancePercent,
      observed.baseCriticalChancePercent,
      'PoB base critical chance',
    );
    close(
      critical.increasedChancePercent,
      observed.increasedCriticalChancePercent,
      'PoB increased critical chance total',
    );
    close(
      critical.addedMultiplierPercent,
      observed.criticalMultiplierExtraPercent -
        (reference.criticalReference.baseMultiplierPercent - 100),
      'PoB added critical multiplier total',
    );
    assert.equal(observed.HitChance, 100);
    assert.equal(observed.ActionSpeedMod, 1);
    close(
      rawResistance.baseResistancePercent,
      observed.rawEnemyLightningResistancePercent,
      'PoB raw enemy resistance',
    );
    assert.equal(rawResistance.maximumResistanceMode, observed.maximumResistanceMode);
    close(
      resistance.uncappedResistancePercent,
      observed.enemyLightningResistanceBeforeClampPercent,
      'PoB exposure before clamp',
    );
    close(
      resistance.penetrationPercent,
      observed.lightningPenetrationPercent,
      'PoB penetration sum',
    );
    if (observed.lightningDamageMultiplier !== undefined)
      close(
        resistance.damageMultiplier,
        observed.lightningDamageMultiplier,
        'PoB lightning damage multiplier',
      );
    assert.deepEqual(
      observed.lightningExposureCandidates,
      expected.exposures
        .filter((exposure) => exposure.enabled && exposure.value !== 0)
        .map((exposure) => ({
          value: exposure.value,
          source: `Custom:${exposure.source.id.slice('pob-config:exposure:'.length)}`,
        })),
    );
    const appliedExposures = observed.enemyLightningResistanceContributions.filter((mod) =>
      mod.source.startsWith('Custom:Exposure '),
    );
    assert.deepEqual(
      appliedExposures,
      resistance.exposurePercent < 0
        ? [
            {
              name: 'LightningResist',
              value: resistance.exposurePercent,
              source: `Custom:${expected.exposures[resistance.selectedExposureIndices[0]].source.id.slice('pob-config:exposure:'.length)}`,
            },
          ]
        : [],
    );
    const observedExposureBlocks = observed.customModifierBlocks.filter((block) =>
      block.title.startsWith('Exposure '),
    );
    assert.deepEqual(
      observedExposureBlocks,
      expected.exposures.map((exposure) => ({
        title: exposure.source.id.slice('pob-config:exposure:'.length),
        enabled: exposure.enabled,
        text: exposure.source.label,
      })),
    );
    assert.deepEqual(
      observed.penetrationContributions,
      expected.penetrationModifiers
        .filter((mod) => mod.value !== 0)
        .map((mod) => ({
          name: 'LightningPenetration',
          value: mod.value,
          source: 'Item:1:Synthetic Spark Fixture, Simple Robe',
          flags: 0,
          keywordFlags: 0,
        })),
    );
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
      const fact = [reference.supportReference, reference.fasterCastingReference].find(
        (entry) => entry.id === gem.skillId,
      );
      assert.ok(fact);
      assert.equal(gem.gameId, fact.gameItemId);
      assert.equal(gem.gemId, fact.pobGemKey);
      assert.equal(gem.nameSpec, fact.name);
    }
    const expectedMoreSupportMods = expected.supports
      .filter((support) => support.enabled)
      .flatMap((support) => {
        const source = `Skill:${support.id}`;
        if (support.id === reference.fasterCastingReference.id)
          return [
            {
              name: 'SupportManaMultiplier',
              value: reference.fasterCastingReference.costMultiplierSource - 100,
              flags: 0,
              keywordFlags: 0,
              source,
            },
          ];
        return [
          {
            name: 'Damage',
            value: reference.supportReference.moreSpellDamageByLevel[support.gemLevel - 1],
            flags: 2,
            keywordFlags: 0,
            source,
          },
          {
            name: 'CritChance',
            value: reference.supportReference.criticalChancePercent,
            flags: 0,
            keywordFlags: 0,
            source,
          },
          {
            name: 'SupportManaMultiplier',
            value: reference.supportReference.costMultiplierSource - 100,
            flags: 0,
            keywordFlags: 0,
            source,
          },
        ];
      });
    const bySupportSource = (entries) =>
      entries.toSorted(
        (left, right) =>
          left.source.localeCompare(right.source) || left.name.localeCompare(right.name),
      );
    assert.deepEqual(
      bySupportSource(observed.supportContributions),
      bySupportSource(expectedMoreSupportMods),
    );
    assert.deepEqual(
      observed.contributions.filter((entry) => entry.source.startsWith('Skill:')),
      expected.supports
        .filter((support) => support.enabled && support.id === reference.fasterCastingReference.id)
        .map((support) => ({
          name: 'Speed',
          value: reference.fasterCastingReference.increasedCastSpeedByLevel[support.gemLevel - 1],
          source: `Skill:${support.id}`,
          flags: 16,
          keywordFlags: 0,
        })),
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
    close(critical.expectedHitMeanAfterResistance, observed.AverageHit, 'PoB AverageHit');
    close(critical.expectedHitMeanAfterResistance, observed.AverageDamage, 'PoB AverageDamage');
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
    const uptime = (expected.shock?.uptimePercent ?? 0) / 100;
    close(
      value.hitDps,
      observed.TotalDPS * (1 - uptime) + observedShocked.TotalDPS * uptime,
      'PoB selected-skill TotalDPS endpoints with explicit host weighting',
    );
    close(
      value.combinedDps,
      observed.CombinedDPS * (1 - uptime) + observedShocked.CombinedDPS * uptime,
      'PoB selected-skill CombinedDPS endpoints with explicit host weighting',
    );
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
    assert.ok(
      observed.contributions.every(
        (entry) =>
          entry.source.startsWith('Item:') ||
          entry.source === `Skill:${reference.fasterCastingReference.id}`,
      ),
      'every increased modifier source has an explicit comparison mapping',
    );
    const compared = observed.contributions
      .filter((entry) => entry.source.startsWith('Item:'))
      .map((entry) => {
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
    const criticalMap = new Map([
      ['CritChance:INC:0:0', 'critical_strike_chance_+%'],
      ['CritChance:INC:2:0', 'spell_critical_strike_chance_+%'],
      ['CritMultiplier:BASE:0:0', 'base_critical_strike_multiplier_+'],
    ]);
    const oracleCriticalItems = observed.criticalContributions
      .filter((mod) => mod.source === 'Item:1:Synthetic Spark Fixture, Simple Robe')
      .map((mod) => {
        const statId = criticalMap.get(`${mod.name}:${mod.type}:${mod.flags}:${mod.keywordFlags}`);
        assert.ok(statId, `Unreviewed PoB critical stat ${mod.name}`);
        return { statId, value: mod.value };
      });
    assert.deepEqual(
      sorted(oracleCriticalItems),
      sorted(expected.criticalModifiers.map(({ statId, value }) => ({ statId, value }))),
    );
    assert.deepEqual(
      observed.criticalContributions.filter((mod) => mod.source === 'Base'),
      [
        {
          name: 'CritMultiplier',
          type: 'BASE',
          value: 50,
          source: 'Base',
          flags: 0,
          keywordFlags: 0,
        },
      ],
    );
    assert.equal(observed.criticalContributions.length, oracleCriticalItems.length + 1);
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
