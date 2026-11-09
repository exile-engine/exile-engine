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

The PoB package exports compatibility types and status only. XML parsing, share-code decompression and complete build import are not implemented. A successful item-modifier match does not imply that every equipment property is modeled.

## Data coverage

Each snapshot manifest records the actual complete rows in its selected build catalogs, schema/tool identities, localizations, SD scopes, inheritance templates, graphs and unresolved source references. This is available client data, not an authoritative implementation of every mechanic or server-only formula.
