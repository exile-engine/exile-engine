# @exile-engine/poe1

PoE1 rules for the initial normal Spark, noncritical single-hit calculation.

```js
import { loadSparkDataset, calculateSpark } from '@exile-engine/poe1';

const loaded = await loadSparkDataset(reader);
if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
const result = calculateSpark(
  {
    identity: reader.identity,
    gemLevel: 20,
    quality: 20,
    modifiers: [],
    effectiveLightningResistancePercent: 0,
  },
  loaded.value,
);
```

`reader` is a matching PoE1 `CatalogReader`, usually supplied by the PoE1 data package. Loading resolves actual `Spark` client records, all supported source levels and ordinary quality. The synchronous calculation uses client-resolved base damage, additive supported increased damage, cast speed and explicit effective resistance. It returns ranges before/after resistance, cast frequency and provenance. No full-build DPS is claimed.

Unsupported supports, variants, flat damage, crit, shock, conversions, conditions and local effects fail with diagnostics. See the root supported-mechanics document and executable example.

`calculateSelectedSkill(input, dataset)` is a separate fresh full-recomputation path for normal Spark selected-skill hit/combined DPS. Input carries `identity`, `buildId`, `skill`, `configuration: { id, effectiveLightningResistancePercent }`, and individual `modifiers`. It counts one noncritical lightning hit per cast; combined DPS equals hit DPS. It follows the pinned reference's hit endpoint rounding, rounded cast-speed multiplier and server-tick ceiling. It does not multiply by projectile count or duration.

`createSelectedSkillSession(input, dataset)` returns a validated session. `session.recalculate(nextInput)` returns the calculation, `recalculated` node names and the current `dependencies`. The session captures immutable dataset facts, tracks changing applicability sets, and retains its last accepted state on invalid updates. `planCalculationGraph` rejects cycles/feedback explicitly instead of assuming every future mechanic is acyclic.

See [supported scope](../../docs/supported-mechanics.md), [executed pinned reference comparison](../../docs/pob-reference.md), and [measured performance](../../docs/selected-skill-performance.md). No Lua, host I/O or PoB runtime is part of this package.
