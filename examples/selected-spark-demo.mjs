import { loadCatalog } from '@exile-engine/data-poe1';
import { importPobXml } from '@exile-engine/pob';
import {
  calculateSelectedSkill,
  createSelectedSkillSession,
  loadSparkDataset,
} from '@exile-engine/poe1';

function value(result) {
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

/** Hosts provide all I/O; this demonstration also runs unchanged in the browser. */
export async function runSelectedSparkDemo(readShard, readXml) {
  const reader = await loadCatalog(readShard);
  const dataset = value(await loadSparkDataset(reader));
  const imported = importPobXml({
    format: 'pob-xml',
    xml: await readXml('crit-combined'),
    target: reader.identity,
    buildId: 'browser-synthetic-spark',
    configurationId: 'explicit-nonboss-25',
  });
  if (!imported.complete) throw new Error(JSON.stringify(imported.diagnostics));
  const initial = value(calculateSelectedSkill(imported.selectedSkill, dataset));
  if (
    initial.addedLightningDamage.contributions.length !== 1 ||
    initial.addedLightningDamage.effectiveness !== 1.9
  )
    throw new Error('Expected the pinned spell added-lightning group and client effectiveness.');
  if (
    initial.supportEffects.supports.length !== 1 ||
    initial.supportEffects.spellDamageMultiplier !== 1 + 39 / 100 ||
    initial.supportEffects.castTimeMultiplier !== 1
  )
    throw new Error('Expected the reviewed support damage and unchanged cast-time rules.');
  if (
    initial.criticalEffects.mode !== 'average' ||
    initial.criticalEffects.chancePercent !== 3 ||
    initial.criticalEffects.criticalMultiplier !== 2
  )
    throw new Error(
      'Expected explicit average critical hits and Controlled Destruction less crit.',
    );
  const session = value(createSelectedSkillSession(imported.selectedSkill, dataset));
  const next = structuredClone(imported.selectedSkill);
  const reports = [];
  for (const change of [
    () => {
      next.modifiers.find((mod) => mod.statId === 'critical_strike_chance_+%').value += 25;
    },
    () => {
      next.modifiers.find((mod) => mod.statId === 'base_critical_strike_multiplier_+').value += 25;
    },
    () => {
      next.configuration.criticalStrikeMode = 'disabled';
    },
    () => {
      next.configuration.criticalStrikeMode = 'average';
    },
    () => {
      next.skill.supports[0].gemLevel = 1;
    },
    () => {
      next.skill.supports[0].enabled = false;
    },
    () => {
      next.skill.supports[0].enabled = true;
    },
    () => {
      next.addedLightningDamage[0].values[0] += 1;
      next.addedLightningDamage[0].values[1] += 2;
    },
    () => {
      next.addedLightningDamage.push({
        statIds: ['spell_minimum_added_lightning_damage', 'spell_maximum_added_lightning_damage'],
        values: [3, 7],
        source: { kind: 'item', id: 'browser-extra-range', line: 1 },
      });
    },
    () => {
      next.addedLightningDamage.splice(0, 1);
    },
    () => {
      next.skill.gemLevel = 1;
    },
    () => {
      next.modifiers[0].value += 10;
    },
    () => {
      next.configuration.effectiveLightningResistancePercent = 50;
    },
    () => {
      next.modifiers[0].statId = 'base_cast_speed_+%';
    },
  ]) {
    change();
    const report = value(session.recalculate(next));
    if (
      JSON.stringify(report.calculation) !==
      JSON.stringify(value(calculateSelectedSkill(next, dataset)))
    )
      throw new Error('Incremental result differs from full recomputation.');
    reports.push({
      recalculated: report.recalculated,
      combinedDps: report.calculation.combinedDps,
      addedLightningDamage: report.calculation.addedLightningDamage,
      supportEffects: {
        spellDamageMultiplier: report.calculation.supportEffects.spellDamageMultiplier,
        criticalChanceMultiplier: report.calculation.supportEffects.criticalChanceMultiplier,
        castTimeMultiplier: report.calculation.supportEffects.castTimeMultiplier,
        contributions: report.calculation.supportEffects.contributions.map(
          ({ statId, value, source, appliedToSelectedHit }) => ({
            statId,
            value,
            source,
            appliedToSelectedHit,
          }),
        ),
      },
      criticalEffects: {
        mode: report.calculation.criticalEffects.mode,
        chancePercent: report.calculation.criticalEffects.chancePercent,
        criticalMultiplier: report.calculation.criticalEffects.criticalMultiplier,
        expectedHitMeanAfterResistance:
          report.calculation.criticalEffects.expectedHitMeanAfterResistance,
        modifierContributions: report.calculation.criticalEffects.modifierContributions,
      },
    });
  }
  const rejected = [];
  for (const name of ['missing-config', 'unsupported', 'added-lightning-reversed']) {
    const result = importPobXml({
      format: 'pob-xml',
      xml: await readXml(name),
      target: reader.identity,
      buildId: name,
      configurationId: 'explicit',
    });
    if (result.complete || result.selectedSkill)
      throw new Error(`Unsafe fixture accepted: ${name}`);
    rejected.push({ fixture: name, diagnostics: result.diagnostics.map((entry) => entry.code) });
  }
  reader.clearCache();
  return { identity: reader.identity, initial, reports, rejected, incrementalEqualsFull: true };
}
