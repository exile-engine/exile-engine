import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { calculateSelectedSkill, loadSparkDataset } from '@exile-engine/poe1';
import { fixtureReader } from '../../core/test/fixture-reader.mjs';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/spark-client.json', import.meta.url), 'utf8'),
);
const loaded = await loadSparkDataset(fixtureReader(fixture));
assert.equal(loaded.ok, true, JSON.stringify(loaded.diagnostics));
const dataset = loaded.value;
const support = {
  id: 'SupportControlledDestruction',
  gemLevel: 20,
  quality: 0,
  enabled: true,
  source: { kind: 'skill', id: 'socket-group:1:gem:2' },
};
const input = {
  identity: dataset.identity,
  buildId: 'support-synthetic',
  skill: { id: 'Spark', gemLevel: 20, quality: 0, supports: [support] },
  configuration: { id: 'explicit-noncritical-enemy', effectiveLightningResistancePercent: 0 },
  modifiers: [],
};

test('Controlled Destruction resolves all reviewed levels, exact identities and eligibility rows', () => {
  const facts = dataset.supports[0];
  assert.deepEqual(facts.identity, dataset.identity);
  assert.equal(facts.id, 'SupportControlledDestruction');
  assert.equal(facts.gemId, 'Metadata/Items/Gems/SupportGemControlledDestruction');
  assert.equal(facts.levels.length, 20);
  for (const level of facts.levels) {
    const original = fixture.tables.GrantedEffectStatSetsPerLevel.find(
      (row) => row.StatSet === 5547 && row.GemLevel === level.gemLevel,
    );
    assert.equal(level.moreSpellDamagePercent, original.AdditionalStatsValues[0]);
    assert.equal(level.criticalStrikeChancePercent, -80);
    assert.equal(level.manaCostMultiplier, 1.4);
    assert.ok(
      level.sourceRows.some(
        (row) => row.table === 'GrantedEffectStatSetsPerLevel' && row.rowIndex === original._index,
      ),
    );
  }
  assert.equal(facts.levels[0].moreSpellDamagePercent, 25);
  assert.equal(facts.levels[19].moreSpellDamagePercent, 39);
  for (const [table, key] of [
    ['Stats', 'support_controlled_destruction_spell_damage_+%_final'],
    ['Stats', 'support_controlled_destruction_critical_strike_chance_+%_final'],
    ['ActiveSkillType', 'Spell'],
    ['ActiveSkillType', 'Damage'],
    ['SkillGems', 'SkillGems:310'],
  ])
    assert.ok(facts.sourceRows.some((row) => row.table === table && row.key === key));
});

test('more multiplies after increases and added damage; less crit is retained and cast time stays explicit', async () => {
  const selected = {
    ...input,
    modifiers: [
      { statId: 'spell_damage_+%', value: 25, source: { kind: 'item', id: 'robe:1', line: 5 } },
    ],
    addedLightningDamage: [
      {
        statIds: ['spell_minimum_added_lightning_damage', 'spell_maximum_added_lightning_damage'],
        values: [1, 2],
        source: { kind: 'item', id: 'robe:1', line: 6 },
      },
    ],
  };
  const result = calculateSelectedSkill(selected, dataset);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.hit.nonCriticalHitBeforeResistance, {
    min: 184,
    max: 3452,
    mean: 1818,
  });
  assert.equal(result.value.combinedDps, 3030);
  assert.equal(result.value.supportEffects.spellDamageMultiplier, 1 + 39 / 100);
  assert.equal(result.value.supportEffects.criticalChanceMultiplier, 0.2);
  assert.equal(result.value.supportEffects.castTimeMultiplier, 1);
  assert.equal(result.value.supportEffects.manaCostMultiplier, 1.4);
  assert.equal(result.value.hit.castTimeSeconds, 0.6);
  assert.deepEqual(
    result.value.supportEffects.contributions.map(
      ({ statId, value, source, appliedToSelectedHit }) => ({
        statId,
        value,
        source,
        appliedToSelectedHit,
      }),
    ),
    [
      {
        statId: 'support_controlled_destruction_spell_damage_+%_final',
        value: 39,
        source: support.source,
        appliedToSelectedHit: true,
      },
      {
        statId: 'support_controlled_destruction_critical_strike_chance_+%_final',
        value: -80,
        source: support.source,
        appliedToSelectedHit: false,
      },
    ],
  );
  const disabled = calculateSelectedSkill(
    { ...selected, skill: { ...selected.skill, supports: [{ ...support, enabled: false }] } },
    dataset,
  );
  assert.equal(disabled.ok, true);
  assert.equal(disabled.value.combinedDps, 2180);
  assert.equal(disabled.value.supportEffects.contributions.length, 2);
  assert.ok(disabled.value.supportEffects.contributions.every((row) => !row.appliedToSelectedHit));
  assert.equal(disabled.value.supportEffects.spellDamageMultiplier, 1);
  assert.equal(disabled.value.supportEffects.criticalChanceMultiplier, 1);
  assert.equal(disabled.value.supportEffects.manaCostMultiplier, 1);
  const changed = structuredClone(fixture);
  changed.tables.GrantedEffects.find((row) => row.Id === 'SupportControlledDestruction').CastTime =
    9999;
  const reloaded = await loadSparkDataset(fixtureReader(changed));
  assert.equal(reloaded.ok, true);
  assert.equal(calculateSelectedSkill(selected, reloaded.value).value.hit.castTimeSeconds, 0.6);
});

test('support input and normalized boundaries reject unknown, ambiguous or missing facts', () => {
  for (const supports of [
    ['Controlled Destruction'],
    [support, support],
    [null],
    [{ ...support, id: 'SupportFasterCasting', enabled: false }],
    [{ ...support, gemLevel: 0 }],
    [{ ...support, gemLevel: 21 }],
    [{ ...support, gemLevel: 1.5 }],
    [{ ...support, quality: 1 }],
    [{ ...support, enabled: undefined }],
    [{ ...support, source: { kind: 'item', id: 'wrong-source' } }],
    [{ ...support, source: Object.create(support.source) }],
    [{ ...support, moreSpellDamagePercent: 100 }],
  ]) {
    const result = calculateSelectedSkill(
      { ...input, skill: { ...input.skill, supports } },
      dataset,
    );
    assert.equal(result.ok, false, JSON.stringify(supports));
    assert.equal('value' in result, false);
  }
  for (const mutate of [
    (data) => {
      delete data.supports;
    },
    (data) => {
      data.supports[0].identity.snapshotId = 'another-snapshot';
    },
    (data) => {
      delete data.supports[0].levels[0];
    },
    (data) => {
      data.supports[0].levels[0].moreSpellDamagePercent = NaN;
    },
    (data) => {
      data.supports[0].levels[0].castTimeMultiplier = 2;
    },
    (data) => {
      data.supports[0].sourceRows[0] = Object.create(data.supports[0].sourceRows[0]);
    },
    (data) => {
      data.supports[0].levels[0].sourceRows[0].cycle = data;
    },
  ]) {
    const data = structuredClone(dataset);
    mutate(data);
    const result = calculateSelectedSkill(input, data);
    assert.equal(result.ok, false);
    assert.equal('value' in result, false);
  }
  const without = structuredClone(dataset);
  delete without.supports;
  assert.equal(
    calculateSelectedSkill({ ...input, skill: { ...input.skill, supports: [] } }, without).ok,
    true,
  );
});

test('support normalization rejects unreviewed mechanics and mismatched scoped references', async () => {
  for (const mutate of [
    (f) => {
      f.tables.GrantedEffects.find((row) => row.Id === 'Spark').CannotBeSupported = true;
    },
    (f) => {
      f.tables.GrantedEffectStatSets.find(
        (row) => row.Id === 'SupportControlledDestruction',
      ).IgnoredStats = [3520];
    },
    (f) => {
      f.tables.GrantedEffectStatSetsPerLevel.find(
        (row) => row.StatSet === 5547,
      ).AdditionalStatsValues = [25, 10];
    },
    (f) => {
      f.tables.GrantedEffectsPerLevel.find(
        (row) => row.GrantedEffect === 5539,
      ).AttackSpeedMultiplier = 10;
    },
    (f) => {
      f.tables.GrantedEffectStatSetsPerLevel = f.tables.GrantedEffectStatSetsPerLevel.filter(
        (row) => !(row.StatSet === 5547 && row.GemLevel === 20),
      );
    },
  ]) {
    const changed = structuredClone(fixture);
    mutate(changed);
    assert.equal((await loadSparkDataset(fixtureReader(changed))).ok, false);
  }
  for (const [table, key, field, index] of [
    ['GrantedEffectStatSets', 'SupportControlledDestruction', 'ConstantStats', 0],
    ['GrantedEffectStatSetsPerLevel', 'GrantedEffectStatSetsPerLevel:43214', 'AdditionalStats', 0],
    ['GrantedEffects', 'SupportControlledDestruction', 'AllowedActiveSkillTypes', 0],
  ]) {
    const reader = fixtureReader(fixture);
    const row = await reader.getRecord(table, key);
    row.fields[field][index] = { ...row.fields[field][index], rowIndex: 999999 };
    assert.equal((await loadSparkDataset(reader)).ok, false);
  }
});
