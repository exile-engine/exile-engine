import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runSparkDemo } from '../examples/spark-demo.mjs';

for (const game of ['poe1', 'poe2']) {
  test(`${game}: real client data -> English/Thai item -> identical Spark calculation`, async () => {
    const root = new URL(`../packages/data-${game}/snapshot/`, import.meta.url);
    const result = await runSparkDemo(game, (relative) => readFile(new URL(relative, root)));
    assert.equal(result.localeRoundTrip, true);
    assert.equal(result.calculation.gemLevel, 20);
    assert.equal(result.calculation.increasedDamagePercent, 28);
    assert.equal(result.calculation.increasedCastSpeedPercent, 10);
    assert.equal(result.calculation.effectiveLightningResistancePercent, 0);
    assert.equal(result.calculation.mode, 'normal-base-noncritical-single-hit');
    assert.ok(result.baseId.startsWith('Metadata/Items/'));
    assert.equal(result.calculation.modifierContributions.length, 2);
  });
}
