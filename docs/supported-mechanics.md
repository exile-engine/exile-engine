# Supported mechanics

## Spark single-hit calculation

| Behavior        | PoE1                                                       | PoE2                                                       |
| --------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| Granted effect  | `Spark`                                                    | `SparkPlayer`                                              |
| Variant/statset | Normal, one hit                                            | Base, one hit                                              |
| Levels          | Every valid level in the pinned source records             | Every valid level in the pinned source records             |
| Base damage     | Client-resolved min/max lightning values                   | Client-resolved min/max lightning values                   |
| Cast time       | Source cast time, scaled by supported increased cast speed | Source cast time, scaled by supported increased cast speed |
| Quality         | Ordinary quality contributions retained and reported       | Ordinary quality contributions retained and reported       |

Applicable unconditional increased damage IDs are `damage_+%`, `spell_damage_+%`, `lightning_damage_+%`, and `projectile_damage_+%`. Their percentages add together. `base_cast_speed_+%` changes cast time without changing a hit's damage.

The caller supplies effective enemy lightning resistance explicitly. This calculation does not infer enemy configuration, resistance caps, exposure or penetration. Results include noncritical minimum, maximum and mean damage before/after resistance, cast time, casts per second, source rows and individual contributions. Extra projectiles and duration are not interpreted as extra hits.

For the isolated-hit APIs above, unsupported variants, support gems, flat added damage, conversions, critical strikes, shock, conditional effects, local modifiers and repeat-hit estimates produce diagnostics. Spell added lightning is implemented separately in the PoE1 selected-skill API below. The library does not report full-build DPS, effective HP or a complete character calculation.

## Item text and PoB

English and Thai are the tested first item-text slice. A copied wand can resolve its base identity and supported damage/cast-speed modifier groups, retain ambiguous or unknown lines for reconciliation and render selected groups in the other locale. Available SD data for other locales is retained, with no blanket claim of tested parser coverage.

The PoB package imports a bounded PoE1 XML subset: explicitly selected normal Spark with ordinary quality, optionally one normal Controlled Destruction support, no allocated passives, simple equipped synthetic items containing the supported modifier lines, and an explicit nonboss enemy configuration. See its package README for the exact accepted grammar and limits. Unknown/ambiguous input retains its source and blocks calculation. URLs, share codes and complete build import are unsupported. A successful modifier match does not imply that every equipment property is modeled.

## PoE1 selected-skill calculation

`calculateSelectedSkill` and `createSelectedSkillSession` support the five increased-damage/cast-speed IDs above and unconditional spell added lightning, grouped as the exact ordered pair `spell_minimum_added_lightning_damage`, `spell_maximum_added_lightning_damage`. Both require game/build/snapshot, build ID, skill selection and configuration ID. Enemy resistance is explicit effective lightning resistance between -200% and 90%; resistance caps, exposure and penetration are not inferred. Damage totals below -100% and rounded cast-speed multipliers at or below zero are rejected.

The optional `addedLightningDamage` input holds at most 1,000 groups, each with `statIds`, `values: [minimum, maximum]`, and shared `source` provenance. Endpoints and their aggregate sums must be nonnegative safe integers, with minimum at most maximum. Repeated and zero-valued groups remain separate and ordered. Unpaired endpoint modifiers, generic/attack added lightning, other elements, local/conditional effects and arbitrary added-damage multipliers are unsupported. The XML grammar accepts only `Adds X to Y Lightning Damage to Spells` with integer endpoints; no affix legality is inferred for synthetic items.

The selected APIs require the exact normalized Spark dataset schema, all five percentage modifier IDs and a finite nonnegative `addedDamageEffectiveness` on every level. The normalizer verifies both added-lightning stat IDs against the same snapshot and derives effectiveness from `GrantedEffectStatSetsPerLevel.DamageEffectiveness / 10000 + 1`. The pinned source contains 9000 at every supported level, yielding 1.9. Missing/invalid source data fails; effectiveness is never supplied by XML, a caller modifier or a hardcoded fallback. Required dataset and source fields must be own properties so capture cannot discard inherited provenance. Unknown dataset fields, partial capability lists, sparse arrays and malformed/cyclic extra records fail before a session captures them.

The metric is **selected-skill hit/combined DPS**: one counted lightning hit per cast, multiplied by casts per second. The default profile counts noncritical hits; the explicit average-critical profile uses the probability-weighted expected mean of noncritical and critical hits. Combined DPS equals hit DPS because this slice has no damage over time, ailments, secondary skills or repeats. Additional Spark projectiles, duration, quality and potential repeat collisions never multiply hits per cast. This is not Full DPS, measured sustained damage or complete PoB parity.

The selected path computes `(intrinsic base + sum(raw added endpoints) × effectiveness) × (1 + increased damage / 100) × supported more damage`, then rounds the pre-resistance endpoints to nearest integer. There is no rounding per group or between effectiveness, increased damage and the supported more multiplier. It rounds the cast-speed multiplier to two decimals and caps cast frequency at `1 / 0.033` per second, following the pinned reference. It does not round after resistance. `castTimeSeconds` is the effective interval between counted casts, including that ceiling. `hit.baseLightningDamage` remains intrinsic; `addedLightningDamage` reports raw, effectiveness, effective and combined-base ranges plus every original group. Source rows retain the exact effectiveness record and stat identities. The original `calculateSpark` isolated-hit API still rejects flat-damage inputs and supports; PoE2 arithmetic is unchanged.

## One support: normal Controlled Destruction

Only `SupportControlledDestruction`, gem levels 1–20 and quality 0, is accepted in `skill.supports`, at most once. Each support record carries `id`, `gemLevel`, `quality`, explicit boolean `enabled` and a skill `source`. The XML adapter requires Spark first and this optional support second in the same selected socket group, with exact game gem ID `Metadata/Items/Gems/SupportGemControlledDestruction`. Awakened variants, other supports, duplicates, unsupported quality and unknown disabled supports remain diagnostic failures.

The PoE1 loader reads twenty support levels from the same snapshot as Spark and verifies the gem/effect/statset chain, exact stat references, and Spark's Spell/Damage eligibility. The reviewed damage stat is `support_controlled_destruction_spell_damage_+%_final`: 25% more spell damage at level 1 and 39% more at level 20. Its multiplier applies after the summed increased-damage categories, before final endpoint rounding. The constant `support_controlled_destruction_critical_strike_chance_+%_final` is -80, an 80% less critical-chance modifier (factor 0.2). This factor applies before chance rounding and the cap in average-critical mode. The raw contribution is retained in disabled-critical mode with `appliedToSelectedHit: false`.

The cast-time multiplier is explicitly **1**. This support has no cast-speed or active cast-time modifier; the support's own `GrantedEffects.CastTime = 1000` does not replace Spark's 600 ms cast time. Cast frequency stays `min(round(1 + increased cast speed / 100, 2) / (Spark base cast time × 1), 1 / 0.033)`. One counted hit per cast remains the metric; no repeats or additional-hit assumptions are introduced.

`supportEffects` reports selected supports, more-spell/critical-chance/cast-time multipliers, raw stat contributions, their gem provenance and exact source rows. It also reports the source-derived 1.4 resource-cost multiplier; actual mana costs and sustainable casting remain outside this DPS slice. A known disabled support retains its identity, raw values and source rows while all applied multipliers equal 1. Missing support facts or mismatched snapshots fail even for a selected disabled support. With no selected support, facts may be absent and all multipliers are 1. Support level, enabled state, membership and source changes are checked against fresh full recomputation and reported separately from base/increased/added-damage dependencies.

## Critical chance and multiplier

Critical mode is explicit configuration data: `criticalStrikeMode: 'average'` requires `ailmentMode: 'excluded'`. An absent mode retains the previous disabled-critical profile; explicit `'disabled'` is also accepted. The XML profile uses exactly `Never deal Critical Strikes` for the previous profile, or exactly `Cannot inflict Elemental Ailments` for the average-critical profile. These are bounded data declarations, not an arbitrary custom-modifier evaluator. Enemy ailments, lucky rolls, charges, flat base-crit overrides, critical-only damage/resistance effects and conditional critical modifiers remain unsupported.

Three additional scalar IDs are accepted in the existing ordered `modifiers` array: `critical_strike_chance_+%`, `spell_critical_strike_chance_+%`, and `base_critical_strike_multiplier_+`. The first two add to one increased-chance pool; the third adds percentage points to total critical multiplier. Raw values and every running aggregate must remain safe integers. Decimal critical item text is rejected: the pinned PoB parser can partially parse it and leave the effect unapplied. Local/conditional contexts and unrelated critical stat IDs fail visibly. These contributions never enter damage-increase or cast-speed totals; they retain individual sources in `criticalEffects.modifierContributions`.

The normalizer reads each Spark level's `SpellCritChance / 100`, yielding 6% across the pinned forty levels. Average critical calculations require the three exact critical stat identities in the same snapshot. The base player critical multiplier is a separately attributed **150% pinned PoE1 rule**, recorded with an external PoB source identity; it is not claimed to come from an absent client `GameConstants` row. With increased-chance total `I`, Controlled Destruction factor `L` (0.2 when enabled, otherwise 1), and added multiplier points `M`, the rules are:

```text
rounded chance percent = round(base chance percent × (1 + I / 100) × L, 2)
applied chance percent = clamp(rounded chance percent, 0, 100)
critical multiplier = 1 + max(0, round((150 - 100 + M) / 100, 2))
```

Disabled mode sets applied chance to zero while retaining nominal facts and contributions. There is no 5% chance floor: Controlled Destruction alone gives 1.2% chance. Its less factor applies before rounding and before the cap; 2000% increased chance therefore gives 25.2% with that support, versus 100% without it. A 17% increase with the support yields 1.404%, rounded to 1.40%. Adding 50 multiplier points changes 1.5× to 2×; sufficiently negative points floor the multiplier at 1×.

Critical endpoints multiply the already rounded noncritical endpoints by the critical multiplier, without a second endpoint rounding. The same explicit effective resistance applies to both hit types. The expected mean is `noncritical mean × (1 - chance / 100) + critical mean × chance / 100`; selected hit/combined DPS is that effective expected mean times casts per second. The mean is an expectation, not a claimed minimum/maximum hit range. `hit` retains the noncritical baseline trace, while `criticalEffects` reports intrinsic chance, increased/less/rounded/applied chance, multiplier points, critical ranges, expected means and source provenance.

Chance, multiplier, critical mode and support mutations are checked against fresh full recomputation, including modifier insertion/removal and reclassification between critical, damage and cast categories. A mode-only edit reuses normal damage and cast values. Support less-crit applicability changes with critical mode; missing or unsupported configurations cannot become successful zero-DPS placeholders.

Fresh calculation recomputes all supported rules. Sessions cache derived nodes and report exactly what was recomputed. Item value changes, modifier insertion/removal or damage/cast-speed reclassification, added-range edits and group insertion/removal, resistance changes and skill/quality changes are tested against fresh full results. Gem-level changes invalidate effectiveness/combined base while retaining raw added sums. No conditional rule is accepted. Feedback graphs are explicitly rejected until a bounded solver is defined. See [reference evidence](pob-reference.md) and [performance record](selected-skill-performance.md).

## Data coverage

Each snapshot manifest records the actual complete rows in its selected build catalogs, schema/tool identities, localizations, SD scopes, inheritance templates, graphs and unresolved source references. This is available client data, not an authoritative implementation of every mechanic or server-only formula.
