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

/** Object field order is immaterial; array positions, own fields and signed numbers are not. */
function sameResult(left, right) {
  if (Object.is(left, right)) return true;
  if (
    left === null ||
    right === null ||
    typeof left !== 'object' ||
    typeof right !== 'object' ||
    Array.isArray(left) !== Array.isArray(right) ||
    (Array.isArray(left) && left.length !== right.length)
  )
    return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameResult(left[key], right[key]))
  );
}

/** Hosts provide all I/O; this demonstration also runs unchanged in the browser. */
export async function runSelectedSparkDemo(readShard, readXml) {
  const reader = await loadCatalog(readShard);
  const dataset = value(await loadSparkDataset(reader));
  const imported = importPobXml({
    format: 'pob-xml',
    xml: await readXml('conductivity-combined'),
    target: reader.identity,
    buildId: 'browser-synthetic-spark',
    configurationId: 'explicit-nonboss-25',
    shockUptimePercent: 40,
  });
  if (!imported.complete) throw new Error(JSON.stringify(imported.diagnostics));
  const initial = value(calculateSelectedSkill(imported.selectedSkill, dataset));
  if (
    initial.addedLightningDamage.contributions.length !== 1 ||
    initial.addedLightningDamage.effectiveness !== 1.9
  )
    throw new Error('Expected the pinned spell added-lightning group and client effectiveness.');
  if (
    initial.supportEffects.supports.length !== 2 ||
    initial.supportEffects.spellDamageMultiplier !== 1 + 39 / 100 ||
    initial.supportEffects.castTimeMultiplier !== 1 ||
    initial.supportEffects.increasedCastSpeedPercent !== 39 ||
    initial.hit.increasedCastSpeedPercent !== 64 ||
    initial.hit.baseCastTimeSeconds !== 0.6
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
  if (
    initial.resistanceEffects.cappedResistancePercent !== 50 ||
    initial.resistanceEffects.penetrationPercent !== 20 ||
    initial.resistanceEffects.effectiveResistancePercent !== 30 ||
    initial.resistanceEffects.conductivity.appliedLightningResistancePercent !== -45 ||
    initial.resistanceEffects.conductivity.excludedShockChance.appliedToSelectedHit !== false
  )
    throw new Error('Expected exposure before the cap and penetration after it.');
  if (
    initial.shockEffects.mode !== 'configured' ||
    initial.shockEffects.magnitudePercent !== 17 ||
    initial.shockEffects.uptimePercent !== 40 ||
    initial.shockEffects.averageDamageMultiplier !== 1 + (17 / 100) * (40 / 100)
  )
    throw new Error('Expected fixed external shock and explicit host uptime.');
  const session = value(createSelectedSkillSession(imported.selectedSkill, dataset));
  const next = structuredClone(imported.selectedSkill);
  const reports = [];
  for (const change of [
    () => {
      next.configuration.lightningResistance.conductivity.gemLevel = 1;
    },
    () => {
      next.configuration.lightningResistance.conductivity.increasedEffectPercent = -50;
    },
    () => {
      next.configuration.lightningResistance.conductivity.increasedEffectPercent = 200;
    },
    () => {
      next.configuration.lightningResistance.conductivity.enabled = false;
    },
    () => {
      next.configuration.lightningResistance.conductivity.enabled = true;
      next.configuration.lightningResistance.conductivity.source.label =
        'Explicit already-active curse';
      next.configuration.lightningResistance.conductivity.effectSource.label =
        'Explicit increased curse effect';
    },
    () => {
      delete next.configuration.lightningResistance.conductivity;
    },
    () => {
      next.configuration.lightningResistance.conductivity = {
        id: 'Conductivity',
        gemLevel: 20,
        quality: 0,
        enabled: true,
        increasedEffectPercent: 25,
        source: { kind: 'scenario', id: 'browser-restored-conductivity' },
        effectSource: { kind: 'scenario', id: 'browser-restored-curse-effect' },
      };
    },
    () => {
      next.skill.supports.find((support) => support.id === 'SupportFasterCasting').gemLevel = 1;
    },
    () => {
      next.skill.supports.find((support) => support.id === 'SupportFasterCasting').enabled = false;
    },
    () => {
      next.skill.supports.find((support) => support.id === 'SupportFasterCasting').enabled = true;
    },
    () => {
      next.skill.supports.reverse();
    },
    () => {
      next.skill.supports.splice(
        next.skill.supports.findIndex((support) => support.id === 'SupportFasterCasting'),
        1,
      );
    },
    () => {
      next.skill.supports.push({
        id: 'SupportFasterCasting',
        gemLevel: 20,
        quality: 0,
        enabled: true,
        source: { kind: 'skill', id: 'browser-restored-faster-casting' },
      });
    },
    () => {
      next.configuration.shock.magnitudePercent = 20;
    },
    () => {
      next.configuration.shock.uptimePercent = 0;
    },
    () => {
      next.configuration.shock.uptimePercent = 100;
    },
    () => {
      next.configuration.shock.source.label = 'Explicit external source, full uptime';
    },
    () => {
      delete next.configuration.shock;
      next.configuration.ailmentMode = 'excluded';
    },
    () => {
      next.configuration.ailmentMode = 'configured-shock';
      next.configuration.shock = {
        magnitudePercent: 17,
        uptimePercent: 40,
        source: { kind: 'scenario', id: 'browser-restored-shock' },
      };
    },
    () => {
      next.configuration.lightningResistance.exposures[0].value = -25;
    },
    () => {
      next.configuration.lightningResistance.exposures.push({
        statId: 'lightning_exposure_on_hit_magnitude',
        value: -30,
        enabled: true,
        source: { kind: 'scenario', id: 'browser-extra-exposure' },
      });
    },
    () => {
      next.configuration.lightningResistance.exposures[0].enabled = false;
    },
    () => {
      next.configuration.lightningResistance.exposures.splice(1, 1);
    },
    () => {
      next.configuration.lightningResistance.exposures[0].enabled = true;
    },
    () => {
      next.configuration.lightningResistance.maximumResistanceMode = 'default75';
    },
    () => {
      next.modifiers.find(
        (mod) => mod.statId === 'base_reduce_enemy_lightning_resistance_%',
      ).value += 5;
    },
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
      next.skill.supports.find(
        (support) => support.id === 'SupportControlledDestruction',
      ).gemLevel = 1;
    },
    () => {
      next.skill.supports.find((support) => support.id === 'SupportControlledDestruction').enabled =
        false;
    },
    () => {
      next.skill.supports.find((support) => support.id === 'SupportControlledDestruction').enabled =
        true;
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
      next.configuration.lightningResistance.baseResistancePercent = 50;
    },
    () => {
      next.modifiers[0].statId = 'base_cast_speed_+%';
    },
  ]) {
    change();
    const report = value(session.recalculate(next));
    if (!sameResult(report.calculation, value(calculateSelectedSkill(next, dataset))))
      throw new Error('Incremental result differs from full recomputation.');
    reports.push({
      recalculated: report.recalculated,
      combinedDps: report.calculation.combinedDps,
      shockEffects: report.calculation.shockEffects,
      resistanceEffects: {
        conductivity: report.calculation.resistanceEffects.conductivity,
        baseResistancePercent: report.calculation.resistanceEffects.baseResistancePercent,
        exposurePercent: report.calculation.resistanceEffects.exposurePercent,
        uncappedResistancePercent: report.calculation.resistanceEffects.uncappedResistancePercent,
        cappedResistancePercent: report.calculation.resistanceEffects.cappedResistancePercent,
        penetrationPercent: report.calculation.resistanceEffects.penetrationPercent,
        effectiveResistancePercent: report.calculation.resistanceEffects.effectiveResistancePercent,
        selectedExposureIndices: report.calculation.resistanceEffects.selectedExposureIndices,
      },
      addedLightningDamage: report.calculation.addedLightningDamage,
      supportEffects: {
        spellDamageMultiplier: report.calculation.supportEffects.spellDamageMultiplier,
        criticalChanceMultiplier: report.calculation.supportEffects.criticalChanceMultiplier,
        castTimeMultiplier: report.calculation.supportEffects.castTimeMultiplier,
        increasedCastSpeedPercent: report.calculation.supportEffects.increasedCastSpeedPercent,
        contributions: report.calculation.supportEffects.contributions.map(
          ({ statId, value, source, appliedToSelectedHit, appliedToCastRate }) => ({
            statId,
            value,
            source,
            appliedToSelectedHit,
            appliedToCastRate,
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
