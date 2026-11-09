import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadCatalog } from '@exile-engine/data-poe1';
import { importPobXml } from '@exile-engine/pob';
import {
  calculateSelectedSkill,
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
    assert.deepEqual(value.identity, reference.identity);
    assert.equal(value.buildId, `fixture:${expected.fixture}`);
    assert.equal(value.configuration.id, `fixture:${expected.fixture}:enemy`);
    assert.equal(value.metric, reference.metric);
    assert.equal(value.engineRevision, reference.engine.rulesRevision);
    assert.equal(value.hitsPerCast, 1);
    assert.deepEqual(value.includedDamage, ['lightning-hit']);
    assert.equal(value.skill.id, 'Spark');
    assert.equal(value.skill.gemLevel, reference.base.gemLevel);
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
    range(
      hit.baseLightningDamage,
      { min: reference.base.minimum, max: reference.base.maximum, mean: reference.base.mean },
      'base',
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
    const minimum = Math.floor(reference.base.minimum * (1 + damageIncrease / 100) + 0.5);
    const maximum = Math.floor(reference.base.maximum * (1 + damageIncrease / 100) + 0.5);
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
    close(hit.baseLightningDamage.min, observed.LightningMinBase, 'PoB base minimum');
    close(hit.baseLightningDamage.max, observed.LightningMaxBase, 'PoB base maximum');
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
  });
}

for (const fixture of ['missing-config', 'unsupported']) {
  test(`${fixture}: rejected XML has no selected-skill calculation input`, async () => {
    const xml = await readFile(new URL(`./fixtures/pob/${fixture}.xml`, import.meta.url), 'utf8');
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
