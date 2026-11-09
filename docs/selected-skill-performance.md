# Selected Spark recomputation and performance

`calculateSelectedSkill` is the fresh reference path. It validates the input and normalized dataset and recalculates every supported operation. `createSelectedSkillSession` captures its own immutable dataset and accepted input, validates every proposed update, and reuses derived values whose dependencies did not change. Rejected updates leave the accepted result and caches intact. A session retains its exact game, build and snapshot; another dataset requires another session.

## Dependency tracking

The twenty derived nodes are `base`, `added-lightning`, `effective-added-lightning`, `combined-base`, `damage-increase`, `cast-speed-increase`, `support-effects`, `critical-chance-increase`, `critical-multiplier-increase`, `lightning-exposure`, `lightning-penetration`, `uncapped-resistance`, `capped-resistance`, `effective-resistance`, `resistance-effects`, `damage-before-resistance`, `damage-after-resistance`, `cast-rate`, `critical-effects` and `selected-skill`.

Reports expose each node's reads and the derived nodes actually evaluated in dependency order. Input comparisons and validation run for every update and are excluded from `recalculated`. The final node assembles the complete result and selected hit/combined DPS.

| Change                                      | Derived work                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Damage modifier                             | Damage increase, normal hit before/after resistance, critical effects, result                                                              |
| Cast-speed modifier                         | Cast-speed increase, cast rate, result                                                                                                     |
| Added-lightning group                       | Raw/effective added lightning, combined base, normal hit before/after resistance, critical effects, result                                 |
| Support level/enabled/source                | Support effects, normal hit before/after resistance, cast rate, critical effects, result                                                   |
| Critical chance or multiplier modifier      | Corresponding critical aggregate, critical effects, result                                                                                 |
| Critical chance modifier becomes multiplier | Both critical aggregates, critical effects, result                                                                                         |
| Critical mode                               | Critical effects, result                                                                                                                   |
| Configured base resistance                  | Uncapped resistance, cap/floor, effective resistance, resistance trace, hit after resistance, critical effects, result                     |
| Exposure strength/enabled/membership        | Exposure selection, uncapped resistance, cap/floor, effective resistance, resistance trace, hit after resistance, critical effects, result |
| Maximum-resistance mode                     | Cap/floor, effective resistance, resistance trace, hit after resistance, critical effects, result                                          |
| Lightning penetration                       | Penetration aggregate, effective resistance, resistance trace, hit after resistance, critical effects, result                              |
| Resistance configuration source             | Resistance trace, result                                                                                                                   |
| Legacy configuration ID                     | Resistance trace, result                                                                                                                   |
| Selected level/quality                      | Base facts, effective added lightning, combined base, normal hit before/after resistance, cast rate, critical effects, result              |
| Identical input                             | None                                                                                                                                       |

Each modifier remains a separate input leaf identified by array position. Exact stat IDs classify four increased-damage categories, cast speed, two increased-critical-chance categories, added critical multiplier and lightning penetration. Reclassifying, adding or removing a contribution replaces the applicable aggregate dependencies. Reordering contributions can cause additional work. Authored values, ordered added-damage groups and individual sources remain visible.

The raw added-lightning aggregate is independent of level-specific effectiveness. A level change refreshes effectiveness and base critical chance while retaining raw sums and modifier aggregates. Support selection is independent of the active skill's base facts. Controlled Destruction applies its more multiplier after additive increases and before endpoint rounding; its cast-time factor is explicitly one. Its less-critical-chance contribution applies to average critical mode when enabled. Result assembly updates that applicability flag without recalculating support multipliers on a mode-only change.

Average critical mode requires `ailmentMode: 'excluded'`. Critical modifiers do not enter normal-hit or cast-speed totals. The trace retains base chance, additive chance, the support less factor, rounding/cap, the pinned base multiplier rule, added multiplier points, critical ranges and expected means. Disabled critical mode uses probability zero while preserving the trace. No extra hit count is inferred.

## Resistance stages

The earlier profile accepts already-effective resistance explicitly. Its cap fields are `null`, with no exposure/cap/penetration inference. Combining that profile with penetration or configured resistance is rejected.

The configured profile requires a bounded integer base resistance, an explicit maximum mode, a scenario source and an explicit exposure list. Every exposure candidate is retained, including disabled entries. `lightning-exposure` reads all candidates, selects the strongest enabled negative magnitude, records all tied indices and applies that magnitude once. It does not sum exposures. Changing membership rebuilds its reads; tests cover former weaker candidates becoming strongest, ties and removals.

Uncapped resistance is base plus selected exposure. The configured maximum follows the pinned PoB configuration behavior, `min(max(base, 75), 90)`; `default75` instead uses 75. The cap/floor node then applies the maximum and the -200 floor. Penetration is subtracted afterward, without another floor. For example, -205 uncapped becomes -200, then 20 penetration produces -220 effective resistance. Normal and critical damage use the same effective value.

Base changes reuse exposure selection. Maximum-mode changes reuse the uncapped value. Penetration changes reuse exposure, uncapped resistance, cap/floor, normal damage before resistance and cast rate. Scenario-source changes only rebuild metadata and the result. The resistance trace exposes every intermediate and retains the exact penetration contributions, exposure sources, selected indices, configuration source and pinned rule source.

Tests compare entire results against fresh recomputation after each mutation, including provenance and intermediate values. They cover zero damage, chance bounds, multiplier floor, resistance bounds/crossings, post-penetration values below -200, missing facts/configuration, malformed and inherited inputs, unsafe integer cancellation, signed zero, immutable ownership and recovery after rejected updates.

## Feedback policy

`planCalculationGraph` bounds nodes and edges, verifies every referenced node and plans without recursive traversal. Self-dependencies and mutual feedback return `graph.feedback-unsupported`; dependent outputs are blocked too. No previous-value fallback, arbitrary iteration count or assumed fixed point is used. These supported rules contain no feedback. A future feedback mechanic needs an explicit solver/state contract, convergence or failure criteria, work bounds and comparison fixtures before it can calculate successfully.

## Reproducible benchmark

Run `npm run build` followed by `node scripts/benchmark-selected-skill.mjs`. The host script uses the recorded PoE1 client fixture (`local-client-fixture`, snapshot `poe1-spark-client-fixture-v1`) with 36 individual item contributions, including three critical modifiers and one penetration modifier; one grouped added-lightning range; level-one enabled Controlled Destruction; level 20 Spark; and average critical mode with ailments excluded. The configured enemy starts at 100 base resistance, configured maximum mode, two exposure candidates (-10 enabled and -25 disabled), and 15 penetration.

Fourteen separate batches each contain 1,000 mutations. Every state is compared completely to fresh recomputation outside the timed region. There are 100 warmup updates, five timed trials, alternating full/incremental trial order and a median per path. Session creation, XML parsing and snapshot loading are excluded; validation, input capture, graph reconstruction/planning and result construction are included. A DPS checksum keeps results observable.

Recorded November 10, 2026, on Windows x64, Node 24.6.0 and npm 11.5.1; engine rule revision `poe1-selected-spark-v5`, working implementation based on Git revision `88cab58d97dac8c75ca16b748da5c81fef2e5eb7`:

| Batch, 1,000 updates                     | Full median | Incremental median | Incremental / full |
| ---------------------------------------- | ----------: | -----------------: | -----------------: |
| Item damage value                        |    44.39 ms |          112.48 ms |               2.53 |
| Enemy base resistance                    |    52.36 ms |          148.83 ms |               2.84 |
| Damage/cast-speed applicability          |    55.78 ms |          223.82 ms |               4.01 |
| Added-lightning range                    |    41.12 ms |          115.93 ms |               2.82 |
| Support level                            |    40.59 ms |          132.20 ms |               3.26 |
| Support enabled state                    |    42.79 ms |          123.33 ms |               2.88 |
| Critical chance                          |    43.37 ms |          116.21 ms |               2.68 |
| Critical multiplier                      |    47.14 ms |          131.50 ms |               2.79 |
| Critical mode                            |    61.41 ms |          155.94 ms |               2.54 |
| Critical chance/multiplier applicability |    46.48 ms |          136.57 ms |               2.94 |
| Exposure strength                        |    46.38 ms |          139.11 ms |               3.00 |
| Exposure enabled state                   |    47.95 ms |          135.88 ms |               2.83 |
| Lightning penetration                    |    46.73 ms |          134.94 ms |               2.89 |
| Penetration/damage applicability         |    46.80 ms |          135.98 ms |               2.91 |

All 14,000 comparisons passed. The first damage/cast applicability, support-level, support-enabled, critical-mode, critical-applicability and penetration-applicability states equal their initial states, so 999 updates in each batch evaluated derived nodes. The other eight batches evaluated the reported nodes 1,000 times. No benchmark mutation recalculated base facts. Penetration-only updates retained all earlier resistance stages; mode-only updates evaluated critical effects and result assembly.

These are development-machine measurements without CPU isolation; batches and repeated runs vary. The incremental path is slower for this small rule set because input validation, capture and graph maintenance outweigh the avoided arithmetic. This demonstrates selective work and equality, not a speedup or production latency guarantee. Both paths retain linear validation work. Full recomputation remains the simple default. Measure a larger supported workload before optimizing graph reuse or introducing keyed patches; these measurements do not justify expanding mechanic coverage.
