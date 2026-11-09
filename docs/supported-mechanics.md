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

Unsupported variants, support gems, flat added damage, conversions, critical strikes, shock, conditional effects, local modifiers and repeat-hit estimates produce diagnostics. The library does not report full-build DPS, effective HP or a complete character calculation.

## Item text and PoB

English and Thai are the tested first item-text slice. A copied wand can resolve its base identity and supported damage/cast-speed modifier groups, retain ambiguous or unknown lines for reconciliation and render selected groups in the other locale. Available SD data for other locales is retained, with no blanket claim of tested parser coverage.

The PoB package imports a bounded PoE1 XML subset: explicitly selected normal Spark with ordinary quality, no supports or allocated passives, simple equipped synthetic items containing the supported modifier lines, and an explicit nonboss enemy configuration. See its package README for the exact accepted grammar and limits. Unknown/ambiguous input retains its source and blocks calculation. URLs, share codes and complete build import are unsupported. A successful modifier match does not imply that every equipment property is modeled.

## PoE1 selected-skill calculation

`calculateSelectedSkill` and `createSelectedSkillSession` support the five increased-damage/cast-speed IDs above. Both require game/build/snapshot, build ID, skill selection and configuration ID. Enemy resistance is explicit effective lightning resistance between -200% and 90%; resistance caps, exposure and penetration are not inferred. Damage totals below -100% and rounded cast-speed multipliers at or below zero are rejected.

The selected APIs require the exact normalized Spark dataset schema and all five supported modifier IDs. Unknown dataset fields, partial capability lists and malformed/cyclic extra records fail before a session captures them. This keeps new dataset semantics from silently entering an apparently complete result.

The metric is **selected-skill hit/combined DPS**: one noncritical lightning hit per cast, multiplied by casts per second. Combined DPS equals hit DPS because this slice has no damage over time, ailments, secondary skills or repeats. Additional Spark projectiles, duration, quality and potential repeat collisions never multiply hits per cast. This is not Full DPS, measured sustained damage or complete PoB parity.

The selected path rounds pre-resistance minimum/maximum hit damage to nearest integer, rounds the cast-speed multiplier to two decimals, and caps cast frequency at `1 / 0.033` per second, following the pinned reference. It does not round after resistance. `castTimeSeconds` is the effective interval between counted casts, including that ceiling. Each result preserves raw individual contributions and source rows alongside intermediate totals and ranges. The original `calculateSpark` isolated-hit API remains unchanged.

Fresh calculation recomputes all supported rules. Sessions cache derived nodes and report exactly what was recomputed. Item value changes, modifier insertion/removal or damage/cast-speed reclassification, resistance changes and skill/quality changes are tested against fresh full results. No conditional rule is accepted. Feedback graphs are explicitly rejected until a bounded solver is defined. See [reference evidence](pob-reference.md) and [performance record](selected-skill-performance.md).

## Data coverage

Each snapshot manifest records the actual complete rows in its selected build catalogs, schema/tool identities, localizations, SD scopes, inheritance templates, graphs and unresolved source references. This is available client data, not an authoritative implementation of every mechanic or server-only formula.
