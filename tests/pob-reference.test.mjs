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
        (1 + damageIncrease / 100) +
        0.5,
    );
    const maximum = Math.floor(
      (expected.baseLightningDamage.max + addedMaximum * expected.addedDamageEffectiveness) *
        (1 + damageIncrease / 100) +
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
