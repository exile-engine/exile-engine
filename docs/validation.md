# Initial validation record

The initial implementation was checked with Node 24.6.0 and npm 11.5.1. The test runner uses the emitted ESM packages, not a TypeScript transpiler. Fifty tests cover core/rules, portable snapshot readers, English/Thai interpretation, actual client-data integration and source-only policy failures.

## Committed data

| Snapshot                        | PoE1        | PoE2        |
| ------------------------------- | ----------- | ----------- |
| Installed build                 | 26474023    | 26476662    |
| Build tables                    | 54          | 64          |
| Source table rows               | 309,910     | 201,013     |
| SD files                        | 45          | 589         |
| Locale-specific SD rules        | 194,277     | 215,339     |
| SD locales                      | 11          | 12          |
| Localized base/class label sets | 9           | 9           |
| Item templates                  | 413         | 277         |
| Passive graphs                  | 7           | 5           |
| Snapshot JSON bytes             | 442,888,299 | 344,507,831 |

Both complete extractions were repeated with the same pinned inputs and produced identical manifest identities:

- PoE1: `cfbf5330f9d85f67070aa163bfd7b1e5d1eb6dc4a045bccfd408708963b052c2`
- PoE2: `d50249f72650fc77e1238e9399f45d2c22412a477e62abf122214d619aa21d28`

The producer and validator preserve source exceptions rather than making the data appear cleaner than the client. PoE1 retains 15 dangling test/zero-base references and one unsupported original SD range. PoE2 retains repeated Atlas node 26306 occurrences in distinct groups and repeated Portuguese description sections. Unresolved references and unsupported inverse mappings do not become invented successful values.

## Runtime and distribution checks

- Source-derived Spark reference cases at levels 1, 20 and 40 match actual client-resolved rows; an independent PoE1 coefficient check covers all 40 levels. PoB was not executed for this initial record; the later bounded comparison below uses a separate oracle.
- The constructed copied-wand example uses actual base labels and description templates, preserves full scoped candidate catalogs, and reconciles to the same canonical IDs and values in English and Thai for both games.
- A real desktop browser imported all seven emitted ESM packages and ran both snapshot/item/calculation flows successfully. The same example also runs in Node.
- Actual npm archives are checked for text-only contents and installed in an isolated temporary consumer. Runtime imports and TypeScript declarations are checked there. Archives are created outside the repository and removed after checking; nothing is published.
- GitHub Actions runs the aggregate verification and executable example on Linux and Windows with Node 24. Check the [workflow runs](https://github.com/exile-engine/exile-engine/actions/workflows/ci.yml) for the specific commit's hosted result.

This initial record establishes the documented single-hit Spark and item-text slice. It does not establish full-build calculations, support for every data record, or universal testing across every JavaScript runtime and locale.

## Bounded selected Spark validation, November 9, 2026

The bounded PoE1 XML fixture suite now covers baseline normal Spark, additive damage categories, cast speed, explicit resistance and supported zero damage. Missing configuration, unsupported mechanics, ambiguous selection, legacy target versions and hostile/over-limit XML remain diagnostic failures with no calculable input. Saved PoB output values never supply calculation inputs.

A separate pinned PoB development oracle imported and calculated the same five successful XML fixtures. Its executed outputs, source revision, host identities, fixture fingerprints, intermediate values and modifier contributions are recorded in [the reference evidence](pob-reference.md). Only versioned text evidence belongs to Exile Engine; the oracle source, Lua runtime and native components stay outside the checkout and runtime dependency graph.

Every supported incremental mutation is checked against a fresh full result, including changed applicability, item insertion/removal, resistance, metadata, gem level/quality, rounding, signed zero, invalid-update recovery and dataset ownership. Cyclic or feedback-dependent graphs fail explicitly. The initial v1 benchmark compared 3,000 updates; the [current measurements](selected-skill-performance.md) add batches for spell added lightning and the reviewed support. The incremental path performs less arithmetic but costs more overall for this small subset.

The original executable example and the bounded XML example run against emitted public exports. A real headless Chrome check using a separate temporary profile imports all seven ESM packages, runs both game/item flows, imports bounded XML, checks three incremental mutations against full results and verifies rejection cases. `npm run test:browser:headless` repeats this check with an installed Chromium browser; `EXILE_ENGINE_BROWSER` can select its executable. Full repository verification includes formatting, emitted-package behavior tests, snapshot validation, source-only policy and isolated archive/declaration consumption. No packages or live services are published.

## Spell added lightning extension

The next bounded slice adds six successful XML fixtures for spell added lightning: one range, repeated ranges, combined damage/cast/resistance modifiers, gem level 1, fractional effectiveness products with final rounding, and a zero-valued group. A reversed range is a diagnostic import failure. The same external pinned PoB oracle executes all eleven successful fixtures; [versioned evidence](pob-reference.md) checks exact input hashes, ordered groups and item-line sources, intrinsic/raw/scaled/combined ranges, effectiveness, increases, resistance, timing and final selected-skill DPS under the existing numeric tolerance.

Normalization tests verify all forty client effectiveness records and reject missing/invalid source fields or stat identities. Full/incremental tests cover added endpoint edits, duplicate/zero groups, membership changes, source ownership, gem-level effectiveness invalidation, unsafe sums, numeric overflow and sparse dataset records. The browser example now exercises added-range edits, insertion/removal and gem-level changes as well as the existing scalar/configuration mutations. The benchmark compares 4,000 complete results; graph bookkeeping still outweighs the avoided arithmetic for this small subset. Legacy isolated-hit and PoE2 arithmetic retain their original scope.

## Controlled Destruction extension

Five additional executed PoB fixtures cover support levels 1 and 20, combined added damage/increases/cast speed/resistance, disabled state and a multiplier-order rounding case. All sixteen successful fixtures compare full and incremental results against the same pinned oracle under the existing numeric tolerance. Exact more/less game stat IDs, gem source, level rows, eligibility, cost multiplier and cast-time factor are retained in [the comparison evidence](pob-reference.md). The less-crit modifier remains outside the explicit noncritical hit metric; the 1.4 cost multiplier does not assert mana sustain. Cast-time factor 1 is checked against PoB, including confirmation that the support's own 1000 ms source record never replaces Spark's active cast time.

Normalization tests exercise missing/unreviewed mechanics, support-gem/effect links, scoped stat/type references, support eligibility and snapshot matching. Boundary tests reject unknown/duplicate/quality-modified supports, inherited identities, sparse/cyclic facts and absent facts for selected supports. Mutation tests cover support level, enabled state, membership and provenance with atomic rejection/recovery. The browser example exercises level and enabled changes against fresh recomputation. Six benchmark batches compare 6,000 complete results; support changes retain cached intrinsic/added damage and increased totals. The core remains portable and the PoB/Lua oracle stays external.

## Critical chance and multiplier extension

Ten additional average-critical fixtures execute the same pinned PoB with elemental ailments explicitly excluded. They cover baseline chance/multiplier, global/spell chance increases, added multiplier points, Controlled Destruction active/disabled, zero chance, capped chance, two-decimal chance rounding, combined damage/configuration and the less-before-cap edge. The complete twenty-six-fixture set compares intermediate values, individual modifiers, source identity and selected-skill expected hit/combined DPS against the oracle, then checks fresh and incremental results for each input. The previous sixteen disabled-critical fixtures retain their results.

All forty source levels verify `SpellCritChance / 100 = 6%`. The 150% player multiplier is explicitly attributed to a pinned rule source rather than fabricated client data. Tests check fractional critical endpoints without rerounding, weighted expected means, the 1× multiplier floor, zero damage, missing policy/facts, scoped snapshots, hidden/sparse metadata and unsafe signed integer accumulation before cancellation. The text adapter rejects decimal crit item lines after execution showed PoB partially parses and leaves them unapplied.

Mutation checks cover critical chance/multiplier edits, source provenance, insertion/removal/reclassification, support interaction and critical-mode transitions, including absent versus explicit optional fields. Critical-only edits reuse normal-hit and cast caches; mode changes recalculate only critical effects and final assembly. The browser example exercises average/disabled mode and modifier changes. Ten benchmark batches compare 10,000 complete results, with performance and recalculated nodes recorded separately. This validates the documented expected-hit slice, without adding ailments, lucky rolls, charges, critical-only effects or Full DPS.

## Lightning exposure, penetration and caps extension

Ten additional pinned PoB fixtures cover penetration, exposure, strongest/disabled exposure candidates, overcapped resistance, both reviewed maximum profiles, negative resistance, the pre-penetration floor, additive penetration and combined critical/support damage. All thirty-six successful XML fixtures compare stages, modifier identities and provenance, normal/critical damage and final selected-skill hit/combined DPS under the existing tolerance. The earlier twenty-six fixture bytes and DPS values remain unchanged.

The normalizer verifies exact penetration/exposure IDs from the same snapshot and records the external cap/order rule. Unit checks distinguish exposure before the cap from penetration after it, show effective -220% resistance without a second floor, preserve tied/inactive/zero sources, and reject mixed, inherited, missing or unsupported profiles. Exposure is explicitly already active; no first-hit or application/uptime claim is made. The XML block profile preserves its reserved critical/ailment declaration because pinned PoB ignores legacy customMods when blocks exist.

Full/incremental checks include raw/legacy transitions, exposure magnitude/enabled/membership/tie changes, cap crossings, penetration edits/reclassification and atomic failure/recovery. Resistance-only changes retain pre-hit damage and cast caches; normal and critical hits consume the same resolved resistance. The browser example exercises the new pipeline, and fourteen benchmark batches compare 14,000 complete results. Performance and scope limits remain documented separately; the oracle and all Lua/native files remain external.

## Explicit configured shock extension, November 10, 2026

Eight additional XML fixtures cover fixed shock with full, zero and partial host uptime; zero, 1% and 50% magnitude; combined added/support/critical/resistance mechanics; and supported zero damage. The pinned external oracle executed all forty-four successful fixtures and a separately hashed unshocked variant for each new shock fixture. Reference checks distinguish native endpoints from host-weighted means/DPS and use the unchanged tolerance `1e-9 + 1e-12 × abs(expected)`. Both engine revisions, exact XML/source/output hashes, native damage-taken contributions and scenario assumptions remain recorded in the reference evidence.

The client shock damage-taken stat row is verified against the same snapshot; configured magnitude and uptime retain scenario provenance and the formula has separate external attribution. Tests reject missing or contradictory policy/uptime, unsupported effect/chance inference, malformed/inherited sources, wrong snapshots and sparse/cyclic facts. Zero magnitude/uptime remains explicit. Full/incremental comparisons include magnitude, uptime, mode membership and provenance edits; combined support/crit/resistance/item changes; cast-only reuse of shock means; ownership and atomic rejection/recovery. The browser example runs these shock mutations through emitted public exports alongside the earlier mechanics. No hit-derived shock, ailment threshold, duration, immunity, stacking or Full DPS behavior is implemented.

Eighteen benchmark batches compare 18,000 complete results. Shock magnitude, uptime and mode changes evaluate only shock effects and final assembly; cast-only edits reuse shock means. Incremental batches take 2.55–3.01 times the full-path median in this development measurement. Validation, input capture and graph costs still outweigh the avoided arithmetic for this subset; the [performance record](selected-skill-performance.md) retains the timings and work reports.

Final verification passed `npm run verify` with 189 behavior tests, snapshot validation, source policy and isolated package import/declaration checks. Both executable examples and the real headless Chrome check passed, including all seven browser ESM imports and shock mutations against full recomputation. Packages were not published.

## Second support: normal Faster Casting extension

Nine additional XML fixtures execute pinned PoB with normal Faster Casting: levels 1 and 20, disabled state, both orders with Controlled Destruction, combined critical/resistance/shock assumptions, integer cast-speed aggregation, the tick ceiling and a negative item subtotal made valid by the support. The fifty-three positive fixtures compare selected-skill hit/combined DPS, one counted lightning hit per cast, under the unchanged tolerance `1e-9 + 1e-12 × abs(expected)`. Per-gem `INC`/`MORE` contributions, item/support speed totals, base and effective cast times, critical interaction, costs and source identities are checked against observed outputs. Partial shock uptime remains an explicit host blend of executed endpoints.

Normalization checks all twenty Faster Casting levels and its exact gem/effect/statset/type joins, including Spell eligibility and Instant/FixedCastTime exclusions. The support's own cast-time record does not replace Spark's base time. Tests distinguish support cast-rate applicability from hit applicability, retain each disabled source, reject unsupported/duplicate/quality-modified gems and malformed/mismatched facts, and cover full/incremental membership, order, provenance, cast-speed reclassification, rounding, caps and atomic failure/recovery. Direct API decimal cast speed remains explicitly tested.

A separately retained native parsing probe shows `12.34% increased Cast Speed` becomes a 12% modifier in PoB's item normalization. The XML adapter now rejects fractional text for all five damage/cast-speed patterns, whose pinned scalability entries use the same integer normalization. Raw rejected lines remain visible; the adapter does not silently import a different applied value. Earlier integer fixtures retain their bytes and results. The Node/browser demonstration now mutates both reviewed supports alongside the previous mechanics, with fresh full results checked after every accepted update.

All 21,000 complete benchmark comparisons passed across twenty-one mutation batches. Faster Casting level/enabled changes and support reordering refresh the shared support node, cast rate, normal/critical/shock consumers and result assembly while retaining base, added damage and item aggregates. Those unchanged damage values are conservatively recomputed by the shared-node design. Incremental batches took 2.18–2.60 times the full-path median in this development measurement; the [performance record](selected-skill-performance.md) reports timings and work without claiming a speedup.

Final `npm run verify` passed with 214 tests, snapshot validation, source-only policy and isolated package imports/declarations. Both executable examples and the real headless Chrome check passed with both reviewed supports and all seven browser ESM imports. No packages were published.

## Explicit configured Conductivity extension

Nine additional XML fixtures execute the same pinned PoB for Conductivity levels 1 and 20, disabled state, fractional scaling with truncation, reduced and zero effect, overcap/floor ordering and the combined support/critical/resistance/shock profile. All sixty-two positive XMLs preserve selected normal Spark, one counted lightning hit per cast, and compare intermediate values, contributions and final selected-skill hit/combined DPS under `1e-9 + 1e-12 × abs(expected)`. The ten configured-shock cases retain native on/off endpoint captures and explicit host uptime weighting. Both revisions and source/XML/output fingerprints remain in the reference evidence.

The normalizer checks all twenty same-snapshot Conductivity levels and the exact normal gem/effect/statset/type/stat chain. Tests verify -17 × 1.25 = -21.25 becomes -21 through two-decimal rounding then truncation toward zero, and -17 × 0.5 becomes -8. The scaled shock-chance side effect remains visible and excluded under the required ailment policy; raw duration and radius do not imply application or uptime. Resistance checks add the curse delta and strongest exposure before caps/floor, then subtract penetration without another floor. Disabled and zero-effect curses retain separate curse/effect provenance.

Boundary checks reject missing/malformed/inherited configuration, unknown or duplicate curse groups, unsupported quality/effect/curse mechanics, absent explicit ailment policy, wrong snapshots and sparse/cyclic facts. Full/incremental checks cover level/effect/enabled changes, removal/reinsertion, both sources, exposure/penetration and cap/floor transitions, changed modifier dependencies and atomic recovery. The browser/Node example now mutates configured Conductivity alongside the previous mechanics and compares accepted updates to fresh complete results. No curse casts, application/uptime, boss/less-effect, immunity/curse limits or generated ailments are modeled.

All 26,000 benchmark comparisons passed across twenty-six mutation batches. The five curse batches refresh the curse trace, uncapped/capped/effective resistance, resistance trace, post-resistance hit, critical/shock means and final result; source-only edits conservatively take that same path. Other mutations reuse the curse cache. Incremental batches took 1.80–2.37 times the full-path median in this development measurement; the [performance record](selected-skill-performance.md) reports timings and work without claiming a speedup.

Final `npm run verify` passed with 237 tests, snapshot validation, source-only policy and isolated package imports/declarations. Both executable examples and the real headless Chrome check passed with configured Conductivity and all seven browser ESM imports. The portable example uses structural equality so object-field order does not cause false differences; array order, own fields and numeric distinctions remain checked. No packages were published.
