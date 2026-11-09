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
    xml: await readXml('resisted'),
    target: reader.identity,
    buildId: 'browser-synthetic-spark',
    configurationId: 'explicit-nonboss-25',
  });
  if (!imported.complete) throw new Error(JSON.stringify(imported.diagnostics));
  const initial = value(calculateSelectedSkill(imported.selectedSkill, dataset));
  const session = value(createSelectedSkillSession(imported.selectedSkill, dataset));
  const next = structuredClone(imported.selectedSkill);
  const reports = [];
  for (const change of [
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
    });
  }
  const rejected = [];
  for (const name of ['missing-config', 'unsupported']) {
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
