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

The isolated-hit API rejects unsupported supports, variants, flat damage, crit, shock, conversions, conditions and local effects with diagnostics. See the root supported-mechanics document and executable example.

`calculateSelectedSkill(input, dataset)` is a separate fresh full-recomputation path for normal Spark selected-skill hit/combined DPS. Input carries `identity`, `buildId`, `skill`, explicit `configuration` and individual `modifiers`. It counts one lightning hit per cast; combined DPS equals hit DPS. The previous configuration `{ id, effectiveLightningResistancePercent }` retains disabled critical strikes. Average critical hits require `{ id, effectiveLightningResistancePercent, criticalStrikeMode: 'average', ailmentMode: 'excluded' }`. It follows the pinned reference's hit endpoint rounding, rounded cast-speed multiplier and server-tick ceiling. It does not multiply by projectile count or duration.

Its optional `addedLightningDamage` array accepts only ordered spell-lightning ranges:

```js
addedLightningDamage: [
  {
    statIds: ['spell_minimum_added_lightning_damage', 'spell_maximum_added_lightning_damage'],
    values: [10, 20],
    source: { kind: 'item', id: 'body-armour:1', line: 5 },
  },
];
```

Raw endpoints and their sums must be nonnegative safe integers with minimum at most maximum. Each group retains both stat IDs, values and shared provenance. The normalizer reads per-level client effectiveness (`1 + DamageEffectiveness / 10000`, currently 1.9), applies it to summed raw endpoints, adds intrinsic damage, then applies increases, any reviewed support more multiplier and final endpoint rounding. The result's `addedLightningDamage` trace reports each stage and every original group; `hit.baseLightningDamage` stays intrinsic. Generic/attack added damage, other elements, local/conditional effects and caller-defined effectiveness remain unsupported. This extension applies to selected-skill APIs; the original isolated-hit API above retains its earlier input contract.

One optional normal Controlled Destruction is supported in `skill.supports`:

```js
supports: [
  {
    id: 'SupportControlledDestruction',
    gemLevel: 20,
    quality: 0,
    enabled: true,
    source: { kind: 'skill', id: 'socket-group:1:gem:2' },
  },
];
```

Only levels 1–20, quality 0 and at most one explicit support record are accepted. `loadSparkDataset` loads matching support facts and validates normal Spark eligibility. The exact more-spell stat grants 25–39% more damage, multiplied after increased damage before hit rounding. Its 80% less critical-chance modifier applies before chance rounding and the cap in average-critical mode, and remains visible but inactive in disabled mode. The cast-time multiplier is 1: Spark retains its source base cast time and existing cast-speed rules. The support's own 1000 ms record is not an active cast-time override. Disabled known supports retain provenance and raw effects with applied multipliers of 1. Other supports, awakened versions, duplicate supports and nonzero support quality fail visibly. `supportEffects` reports raw contributions, source rows and all multipliers, including the 1.4 cost multiplier without calculating mana sustain.

The ordered `modifiers` array also accepts `critical_strike_chance_+%`, `spell_critical_strike_chance_+%` and `base_critical_strike_multiplier_+`, with safe integer raw values and running totals. Chance increases add; global multiplier additions are percentage points. Spark's 6% base chance comes from client level records. The 150% base player multiplier is explicitly attributed to the pinned PoE1 rule, not a client table row. `criticalEffects` retains the chance stages, Controlled Destruction factor, multiplier stages, non-rerounded critical endpoints, expected hit means and individual modifier sources. In average mode, hit DPS uses the probability-weighted expected mean; `hit` remains the noncritical baseline. Chance is rounded to two decimals then capped at 0–100%, and multiplier is floored at 1×. Ailments are excluded, and lucky chance, charges, base overrides and critical-only conditions remain unsupported. See the supported-mechanics document for exact formulas and rounding order.

`createSelectedSkillSession(input, dataset)` returns a validated session. `session.recalculate(nextInput)` returns the calculation, `recalculated` node names and the current `dependencies`. The session captures immutable dataset facts, tracks changing applicability sets, and retains its last accepted state on invalid updates. `planCalculationGraph` rejects cycles/feedback explicitly instead of assuming every future mechanic is acyclic.

Lightning exposure, caps and penetration use an explicit raw configuration, exclusive with the previous already-effective value:

```js
lightningResistance: {
  baseResistancePercent: 110,
  maximumResistanceMode: 'configured',
  source: { kind: 'scenario', id: 'enemy-base-resistance' },
  exposures: [{ statId: 'lightning_exposure_on_hit_magnitude', value: -15, enabled: true,
    source: { kind: 'scenario', id: 'already-active-exposure' } }],
}
```

Add penetration as sourced `modifiers` with the exact ID `base_reduce_enemy_lightning_resistance_%`, such as value 20. The strongest active exposure lowers uncapped resistance first; the reviewed maximum and -200% floor apply next; penetration subtracts last without another floor. The example resolves to 70% effective resistance. `'default75'` instead of `'configured'` fixes the maximum at 75% and resolves the example to 55%; configured mode derives the maximum as `min(max(raw, 75), 90)` to match the pinned PoB profile. Both normal and critical hits share the result.

Raw resistance is an integer in -1000…1000, up to eight exposure candidates have signed integer magnitudes -100…0, and penetration values/sum are integers in 0…200. Candidates are explicit already-active state, with no on-hit chance or uptime inference. `resistanceEffects` retains all stages, individual penetration sources, exposure candidates/ties, rule attribution and source rows. Already-effective configurations retain their old behavior and reject any penetration occurrence to prevent ambiguous double application. Other caps, curses, conditional/critical-only penetration and resistance mechanics remain unsupported; see the full scope document for XML profiles and exact validation limits.

See [supported scope](../../docs/supported-mechanics.md), [executed pinned reference comparison](../../docs/pob-reference.md), and [measured performance](../../docs/selected-skill-performance.md). No Lua, host I/O or PoB runtime is part of this package.
