# Selected Spark recomputation and performance

`calculateSelectedSkill` is the fresh reference path. It validates the input and normalized dataset and recalculates every supported operation. `createSelectedSkillSession` captures its own immutable dataset and accepted input, validates every proposed update, and reuses derived values whose dependencies did not change. Rejected updates leave the accepted result and caches intact. A session retains its exact game, build and snapshot; another dataset requires another session.

## Dependency tracking

The twenty-two derived nodes are `base`, `added-lightning`, `effective-added-lightning`, `combined-base`, `damage-increase`, `cast-speed-increase`, `support-effects`, `critical-chance-increase`, `critical-multiplier-increase`, `lightning-exposure`, `lightning-penetration`, `conductivity-effects`, `uncapped-resistance`, `capped-resistance`, `effective-resistance`, `resistance-effects`, `damage-before-resistance`, `damage-after-resistance`, `cast-rate`, `critical-effects`, `shock-effects` and `selected-skill`.

Reports expose each node's reads and the derived nodes actually evaluated in dependency order. Input comparisons and validation run for every update and are excluded from `recalculated`. The final node assembles the complete result and selected hit/combined DPS.

| Change                                              | Derived work                                                                                                                                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Damage modifier                                     | Damage increase, normal hit before/after resistance, critical effects, shock effects, result                                                                |
| Cast-speed modifier                                 | Cast-speed increase, cast rate, result                                                                                                                      |
| Added-lightning group                               | Raw/effective added lightning, combined base, normal hit before/after resistance, critical effects, shock effects, result                                   |
| Support level/enabled/source/order                  | Support effects, normal hit before/after resistance, cast rate, critical effects, shock effects, result                                                     |
| Critical chance or multiplier modifier              | Corresponding critical aggregate, critical effects, shock effects, result                                                                                   |
| Critical chance modifier becomes multiplier         | Both critical aggregates, critical effects, shock effects, result                                                                                           |
| Critical mode                                       | Critical effects, shock effects, result                                                                                                                     |
| Configured base resistance                          | Uncapped resistance, cap/floor, effective resistance, resistance trace, hit after resistance, critical effects, shock effects, result                       |
| Exposure strength/enabled/membership                | Exposure selection, uncapped resistance, cap/floor, effective resistance, resistance trace, hit after resistance, critical effects, shock effects, result   |
| Conductivity level/effect/enabled/source/membership | Conductivity effects, uncapped resistance, cap/floor, effective resistance, resistance trace, hit after resistance, critical effects, shock effects, result |
| Maximum-resistance mode                             | Cap/floor, effective resistance, resistance trace, hit after resistance, critical effects, shock effects, result                                            |
| Lightning penetration                               | Penetration aggregate, effective resistance, resistance trace, hit after resistance, critical effects, shock effects, result                                |
| Resistance configuration source                     | Resistance trace, result                                                                                                                                    |
| Legacy configuration ID                             | Resistance trace, result                                                                                                                                    |
| Shock magnitude/uptime/source/mode                  | Shock effects, result                                                                                                                                       |
| Selected level/quality                              | Base facts, effective added lightning, combined base, normal hit before/after resistance, cast rate, critical effects, shock effects, result                |
| Identical input                                     | None                                                                                                                                                        |

Each modifier remains a separate input leaf identified by array position. Exact stat IDs classify four increased-damage categories, cast speed, two increased-critical-chance categories, added critical multiplier and lightning penetration. Reclassifying, adding or removing a contribution replaces the applicable aggregate dependencies. Reordering contributions can cause additional work. Authored values, ordered added-damage groups and individual sources remain visible.

The raw added-lightning aggregate is independent of level-specific effectiveness. A level change refreshes effectiveness and base critical chance while retaining raw sums and modifier aggregates. Support selection is independent of the active skill's base facts. Normal Controlled Destruction and Faster Casting are supported at levels 1–20 and quality zero, individually or together, with at most one occurrence of each. Input order and disabled raw contributions remain visible. Unknown, duplicate and extra supports are rejected.

Controlled Destruction applies its more multiplier after additive increases and before endpoint rounding. Its less-critical-chance contribution applies to average critical mode when that support is enabled. Result assembly updates that flag without recalculating support effects on a critical-mode-only change. Enabling Faster Casting while Controlled Destruction is disabled does not apply the latter's critical penalty.

Faster Casting contributes its 20–39% increased cast speed to the same additive pool as item cast speed. `cast-speed-increase` caches the item/scalar subtotal; `support-effects` reports the support subtotal. The cast node adds them once, rounds the combined speed multiplier to two decimals, checks it is positive, and applies the server-tick ceiling. `hit.increasedCastSpeedPercent` reports the total, while item and support occurrences retain separate sources. No support contribution is appended to `input.modifiers`. Both supports have cast-time multiplier one and preserve the active Spark base interval. Mana multipliers remain metadata; resource costs and sustainable casting are outside this calculation.

The rounded combined pool determines validity. An item-only -100% cast-speed pool is valid with enabled level-one Faster Casting: the total is -80%, giving a positive 0.2 multiplier. Removing or disabling the support can invalidate that input. Tests verify atomic rejection and recovery, including rounding boundaries. Sessions initialize the cached item subtotal from input occurrences so later configuration changes cannot add the support twice.

The support-effects node conservatively refreshes all its consumers. A Faster Casting-only level, enabled-state, source or order change therefore recalculates normal-hit, cast, critical and shock nodes even when only cast-related values change. Tests confirm the unchanged damage values, and reports expose the actual extra work. Separate numerical support projections have not been introduced.

Average critical mode requires an explicit ailment profile: `ailmentMode: 'excluded'`, or `ailmentMode: 'configured-shock'` with the bounded shock scenario described below. Critical modifiers do not enter normal-hit or cast-speed totals. The trace retains base chance, additive chance, the support less factor, rounding/cap, the pinned base multiplier rule, added multiplier points, critical ranges and expected means. Disabled critical mode uses probability zero while preserving the trace. No extra hit count is inferred.

## Resistance stages

The earlier profile accepts already-effective resistance explicitly. Its cap fields are `null`, with no exposure/cap/penetration inference. Combining that profile with penetration, Conductivity or configured resistance is rejected.

The configured profile requires a bounded integer base resistance, an explicit maximum mode, a scenario source and an explicit exposure list. Every exposure candidate is retained, including disabled entries. `lightning-exposure` reads all candidates, selects the strongest enabled negative magnitude, records all tied indices and applies that magnitude once. It does not sum exposures. Changing membership rebuilds its reads; tests cover former weaker candidates becoming strongest, ties and removals.

Uncapped resistance is base plus selected exposure plus the already-active Conductivity resistance contribution, in that order. The configured maximum follows the pinned PoB configuration behavior, `min(max(base, 75), 90)`; `default75` instead uses 75. The cap/floor node then applies the maximum and the -200 floor. Penetration is subtracted afterward, without another floor. For example, -205 uncapped becomes -200, then 20 penetration produces -220 effective resistance. Normal and critical damage use the same effective value.

Base changes reuse exposure selection and Conductivity effects. Maximum-mode changes reuse the uncapped value. Penetration changes reuse exposure, Conductivity effects, uncapped resistance, cap/floor, normal damage before resistance and cast rate. Scenario-source changes only rebuild metadata and the result. The resistance trace exposes every intermediate and retains the exact penetration contributions, exposure sources, selected indices, configuration source and pinned rule source.

Tests compare entire results against fresh recomputation after each mutation, including provenance and intermediate values. They cover zero damage, chance bounds, multiplier floor, resistance bounds/crossings, post-penetration values below -200, missing facts/configuration, malformed and inherited inputs, unsafe integer cancellation, signed zero, immutable ownership and recovery after rejected updates.

## Configured Conductivity

Only normal Conductivity levels 1–20 at quality zero are accepted. Its already-active state is nested under configured lightning resistance, with an enabled flag, an explicit increased-effect value from -100% through 200%, a scenario source and a separate effect source. The earlier already-effective resistance profile cannot combine with a configured curse. Other curses, global curse-effect item modifiers and automatic curse application remain unsupported.

`conductivity-effects` resolves the exact snapshot's level facts. It scales the negative lightning-resistance stat by `1 + increasedEffectPercent / 100`, rounds to two decimals and then truncates toward zero. The enabled state selects that value or zero as the applied contribution. Absent Conductivity produces an explicit `null` trace. Disabled state and -100% effect preserve their raw facts and provenance while contributing zero resistance reduction. The trace exposes base, scaled, rounded, truncated and applied values, plus the exact `base_lightning_damage_resistance_%` and `curse_effect_+%` contributions with their separate sources.

The applied reduction joins base resistance and strongest exposure before maximum resistance and the -200 floor. Penetration follows afterward. Duration and radius remain source metadata for the already-active scenario; casting, reapplication, curse limits and uptime are not inferred. Conductivity's authored 25% chance to be shocked is retained, including its scaled value and source, with `appliedToSelectedHit: false`. An explicit excluded or configured-shock ailment policy is required; the chance never generates an assumed shock state.

Level, effect, enabled-state, source and membership changes refresh the curse and downstream resistance/hit stages, preserving base damage, damage increases, cast speed, support effects and exposure selection. Penetration changes reuse the curse calculation. Source-only curse changes currently use the same conservative downstream invalidation even when the numeric reduction remains equal. Tests verify source ownership, negative rounding, cap/floor masking, post-penetration resistance below -200, removal, missing facts and atomic recovery.

## Configured shock stage

Configured shock requires `ailmentMode: 'configured-shock'` and explicit integer magnitude (0–50%), uptime (0–100%) and scenario provenance. The supplied uptime is independent of the hit and critical distribution. The stage reports the unshocked and fully shocked expected-hit endpoints, the full-shock multiplier and the average multiplier `1 + (magnitude / 100) * (uptime / 100)`. It applies that average multiplier to post-resistance normal, critical and expected hit means. Existing hit and critical traces remain unshocked; final DPS uses `expectedHitMeanAfterShock * castsPerSecond`.

Pinned PoB supplies executed unshocked and fully shocked endpoints. Partial uptime is the documented host-weighted combination of those endpoints; it does not represent a native PoB uptime calculation. Zero magnitude and zero uptime retain their explicit configuration and produce the appropriate unchanged mean. Excluded mode preserves earlier results.

Magnitude, uptime, source and mode changes evaluate only `shock-effects` and result assembly. A critical-mode change also evaluates critical effects first. Cast-speed-only changes retain shock means and recalculate the final DPS using the new cast rate. Tests cover those boundaries, zero damage, full/partial/zero uptime, source ownership, missing facts, malformed/inherited inputs and rejected shock-related scalar modifiers. Automatic shock application, ailment thresholds and uptime prediction remain unsupported.

## Feedback policy

`planCalculationGraph` bounds nodes and edges, verifies every referenced node and plans without recursive traversal. Self-dependencies and mutual feedback return `graph.feedback-unsupported`; dependent outputs are blocked too. No previous-value fallback, arbitrary iteration count or assumed fixed point is used. These configured rules contain no feedback. Deriving shock from its own resulting damage would introduce feedback and remains unsupported. A future feedback mechanic needs an explicit solver/state contract, convergence or failure criteria, work bounds and comparison fixtures before it can calculate successfully.

## Reproducible benchmark

Run `npm run build` followed by `node scripts/benchmark-selected-skill.mjs`. The host script uses the recorded PoE1 client fixture (`local-client-fixture`, snapshot `poe1-spark-client-fixture-v1`) with 36 individual item contributions, including three critical modifiers and one penetration modifier; one grouped added-lightning range; enabled level-one Controlled Destruction and Faster Casting; level 20 Spark; average critical mode; and configured shock of 20% magnitude with 50% supplied uptime. The enemy starts at 100 base resistance, configured maximum mode, two exposure candidates (-10 enabled and -25 disabled), 15 penetration, and enabled level-one Conductivity with zero increased effect.

Twenty-six separate batches each contain 1,000 mutations. Every state is compared completely to fresh recomputation outside the timed region. There are 100 warmup updates, five timed trials, alternating full/incremental trial order and a median per path. Session creation, XML parsing and snapshot loading are excluded; validation, input capture, graph reconstruction/planning and result construction are included. A DPS checksum keeps results observable.

Recorded November 10, 2026, on Windows x64, Node 24.6.0 and npm 11.5.1; engine rule revision `poe1-selected-spark-v8`, working implementation based on Git revision `94fdb5d633de9ec6b01d8f19bd06392488160ca6`:

| Batch, 1,000 updates                     | Full median | Incremental median | Incremental / full |
| ---------------------------------------- | ----------: | -----------------: | -----------------: |
| Item damage value                        |    61.57 ms |          115.17 ms |               1.87 |
| Enemy base resistance                    |    59.60 ms |          119.48 ms |               2.00 |
| Damage/cast-speed applicability          |   110.29 ms |          208.79 ms |               1.89 |
| Added-lightning range                    |   111.33 ms |          214.16 ms |               1.92 |
| Controlled Destruction level             |   122.11 ms |          237.89 ms |               1.95 |
| Controlled Destruction enabled           |   110.63 ms |          232.25 ms |               2.10 |
| Critical chance                          |   112.79 ms |          224.75 ms |               1.99 |
| Critical multiplier                      |   111.41 ms |          223.52 ms |               2.01 |
| Critical mode                            |   116.54 ms |          232.48 ms |               1.99 |
| Critical chance/multiplier applicability |   111.83 ms |          217.68 ms |               1.95 |
| Exposure strength                        |   113.35 ms |          235.12 ms |               2.07 |
| Exposure enabled state                   |   115.47 ms |          237.12 ms |               2.05 |
| Lightning penetration                    |   112.26 ms |          238.56 ms |               2.13 |
| Penetration/damage applicability         |   124.47 ms |          241.16 ms |               1.94 |
| Item cast speed only                     |   127.60 ms |          265.47 ms |               2.08 |
| Shock magnitude                          |   151.43 ms |          279.97 ms |               1.85 |
| Shock uptime                             |   116.30 ms |          230.82 ms |               1.98 |
| Shock mode                               |   141.42 ms |          254.31 ms |               1.80 |
| Faster Casting level                     |   112.10 ms |          239.14 ms |               2.13 |
| Faster Casting enabled                   |   114.83 ms |          240.77 ms |               2.10 |
| Support order                            |   117.55 ms |          224.75 ms |               1.91 |
| Conductivity level                       |   121.17 ms |          250.49 ms |               2.07 |
| Conductivity enabled                     |   107.80 ms |          255.06 ms |               2.37 |
| Conductivity effect                      |   135.69 ms |          291.55 ms |               2.15 |
| Conductivity source                      |   118.91 ms |          258.63 ms |               2.17 |
| Conductivity membership                  |   113.44 ms |          244.48 ms |               2.16 |

All 26,000 comparisons passed. Thirteen batches begin with a state equal to the initial input and evaluate derived nodes for 999 subsequent updates; the other thirteen evaluate the reported nodes 1,000 times. No benchmark mutation recalculated base facts. The five Conductivity batches evaluated exactly the curse node and its eight downstream consumers. All other batches retained the curse cache. Penetration-only updates retained earlier resistance stages. Shock edits evaluated only shock effects and result assembly; item cast-speed-only edits reused shock means. Support changes used the conservative aggregate invalidation described above.

These are development-machine measurements without CPU isolation; batches and repeated runs vary. The incremental path is slower for this small rule set because input validation, capture and graph maintenance outweigh the avoided arithmetic. This demonstrates selective work and equality, not a speedup or production latency guarantee. Both paths retain linear validation work. Full recomputation remains the simple default. Measure a larger supported workload before optimizing graph reuse or introducing keyed patches; these measurements do not justify expanding mechanic coverage.
