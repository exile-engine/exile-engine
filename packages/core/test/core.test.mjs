import assert from 'node:assert/strict';
import test from 'node:test';
import {
  errorDiagnostic,
  failure,
  isSnapshotIdentity,
  sameSnapshot,
  success,
  SPARK_MODIFIER_STAT_IDS,
} from '@exile-engine/core';

test('snapshot compatibility requires exact game, build and content identity', () => {
  const identity = { game: 'poe1', build: '3.27.0', snapshotId: 'sha256:example' };
  assert.equal(isSnapshotIdentity(identity), true);
  assert.equal(isSnapshotIdentity({ ...identity, game: 'poe3' }), false);
  assert.equal(isSnapshotIdentity({ ...identity, snapshotId: '' }), false);
  assert.equal(isSnapshotIdentity(null), false);
  assert.equal(sameSnapshot(identity, { ...identity }), true);
  for (const changes of [{ game: 'poe2' }, { build: '3.27.1' }, { snapshotId: 'other' }]) {
    assert.equal(sameSnapshot(identity, { ...identity, ...changes }), false);
  }
});

test('result helpers preserve explicit diagnostics without invented successful values', () => {
  const diagnostic = errorDiagnostic('test.unsupported', 'Unsupported mechanic');
  assert.deepEqual(failure(diagnostic), { ok: false, diagnostics: [diagnostic] });
  assert.deepEqual(success(42), { ok: true, value: 42, diagnostics: [] });
  assert.deepEqual(success(42, [diagnostic]), { ok: true, value: 42, diagnostics: [diagnostic] });
});

test('supported stat identities preserve client punctuation exactly', () => {
  assert.deepEqual(SPARK_MODIFIER_STAT_IDS, [
    'damage_+%',
    'spell_damage_+%',
    'lightning_damage_+%',
    'projectile_damage_+%',
    'base_cast_speed_+%',
  ]);
});
