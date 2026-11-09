# Conventions

## Code and API

- Use named exports, camelCase values/functions, PascalCase types, and descriptive kebab-case files. Prettier controls two-space indentation, single quotes and LF endings.
- Use strict TypeScript and explicit exported contracts. Prefer readonly input records, pure functions and discriminated results. Type assertions do not replace validation at an external-input boundary.
- Use actual package names across workspaces and emitted `.js` extensions for relative source imports. Do not import another package's internal source path or add a `paths` shortcut.
- Runtime packages use standard JavaScript. Host-specific I/O belongs in examples/tooling or a separately designed adapter. Core has zero runtime dependencies.
- Keep stable diagnostic codes and include source provenance. Separate unsupported, ambiguous and malformed inputs. Do not silently ignore an effect that could change the requested result.

## Stats, units and arithmetic

- Retain the exact canonical game stat ID. Do not sanitize it, translate it, use a description alias instead, or convert it to a PoB internal name.
- Store raw source values and preserve their source records. Convert units explicitly at the rule boundary: for example, client cast time milliseconds becomes seconds in the calculation result.
- Preserve spell added-lightning minimum/maximum IDs and values as one ordered group with shared provenance. Raw endpoints and their sums are safe integers; effectiveness is the client level field divided by 10000 plus 1. Sum raw ranges before applying effectiveness, and retain fractional products through increased damage until final hit rounding.
- A percentage contribution is in percentage points: `28` means 28%, not `0.28`. Document scale and rounding for every new mechanic.
- The selected critical slice accepts integer chance increases and additive multiplier points, with safe integer running totals. Global and spell chance increases share one pool; Controlled Destruction less chance applies before two-decimal chance rounding and the cap. Critical endpoints scale the already rounded normal hit without rerounding, and DPS uses a probability-weighted mean under an explicit ailment policy. Attribute the 150% player multiplier to its pinned rule source separately from client-authored base chance.
- Each occurrence keeps provenance. Sum applicable increased damage categories additively in the Spark slice. Cast-speed scaling is separate. Only explicitly reviewed support more/less effects are accepted, with multiplication separate from increased totals and before final hit rounding; other effects, conditions and local modifiers require their own implementation. The PoE1 selected-skill API additionally follows its pinned PoB endpoint/speed rounding and tick ceiling; the original isolated-hit API keeps its existing arithmetic contract.
- Use finite numbers and validate domains and divisors. Preserve game-specific rounding where the source resolves base values. Do not manufacture additional rounding on intermediate presentation values.
- Treat exposure and penetration as separate operations. An explicitly active negative exposure lowers uncapped enemy resistance; only the strongest applies. Cap/floor next, then subtract unconditional penetration without reapplying the floor. Preserve every candidate and penetration occurrence, with scenario state separate from item modifiers and the already-effective profile kept exclusive.
- Configured shock magnitude and uptime are explicit scenario percentages, independent of hit-derived ailments. Apply its increased-damage-taken factor to post-resistance normal/critical damage without rerounding; keep unshocked traces and exact stat identity separate from scenario and formula provenance. Partial uptime assumes the same casting and damage distribution in both states and is checked against a host blend of executed PoB endpoints.
- Faster Casting's increased speed adds to item cast speed before rounding and positive-multiplier validation. Keep its gem contribution separate from original item occurrences. Both reviewed support records have cast-time factor 1; their 1000 ms records never override Spark's base time. Preserve support selection order and distinguish hit applicability from cast-rate applicability.
- Configured Conductivity scales source resistance by the explicit curse-effect factor, rounds to two decimals, then truncates toward zero. Add its active delta and strongest exposure before caps; penetrate afterward. Keep curse and effect sources separate, including zero/disabled states, and retain the excluded shock-chance side effect. Already-active state does not infer curse application, uptime or boss/immunity rules.

## Versions and documentation

Package versions follow semver; all initial packages are `0.1.0`. Dataset build and snapshot IDs are separate. Data updates need their own review even if no engine rule changes.

Keep implementation status near the API and in `docs/supported-mechanics.md`. Examples must run against public exports. Tag reference values as client-authored, source-derived or executed comparisons, as appropriate. Source-derived golden tests are not evidence of a live PoB comparison.

Commit deterministic UTF-8 text. Generated catalogs are compact JSON shards, not formatter output. Never edit a snapshot directly to conceal a schema, reference or parser failure; fix the producer and regenerate.
