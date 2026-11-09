# Selected Spark recomputation and performance

`calculateSelectedSkill` is the fresh reference path. It validates every input and dataset fact and recalculates all supported operations. `createSelectedSkillSession` captures its own immutable dataset and accepted input, validates every proposed update, and reuses derived values whose dependencies did not change. Rejected updates leave the last accepted calculation and graph intact. A session cannot change game, build or snapshot; create another session for another dataset.

The eleven derived nodes are `base`, `added-lightning`, `effective-added-lightning`, `combined-base`, `damage-increase`, `cast-speed-increase`, `support-effects`, `damage-before-resistance`, `damage-after-resistance`, `cast-rate` and `selected-skill`. `added-lightning` sums raw endpoints from ordered spell-lightning groups; `effective-added-lightning` applies the selected gem level's verified effectiveness; `combined-base` adds that range to intrinsic skill damage. `support-effects` resolves the bounded Controlled Destruction selection against captured client facts, retaining more spell damage, less critical chance, explicit cast-time factor and mana multiplier. The final node assembles the complete trace and selected hit/combined DPS. Reports expose the actual dependency record and derived nodes evaluated in dependency order. Input comparisons and validation run on every update and are excluded from `recalculated`.

| Change                                           | Derived nodes evaluated                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Applicable damage modifier value                 | Damage increase, damage before resistance, damage after resistance, selected skill                            |
| Explicit enemy resistance                        | Damage after resistance, selected skill                                                                       |
| Configuration ID only                            | Selected skill                                                                                                |
| Damage modifier changes into cast-speed modifier | Both increase totals, cast rate, damage before/after resistance, selected skill                               |
| Added-lightning range or group membership        | Raw added lightning, effective added lightning, combined base, damage before/after resistance, selected skill |
| Support level, enabled state or source           | Support effects, damage before/after resistance, cast rate, selected skill                                    |
| Selected gem level or quality                    | Base, effective added lightning, combined base, damage before/after resistance, cast rate, selected skill     |
| Identical input                                  | None                                                                                                          |

Each contribution remains a separate input leaf identified by its array position. Each added-lightning group remains one leaf containing its ordered minimum/maximum stat IDs, two values and shared provenance. Reordering contributions may cause extra work. On every update the graph derives each aggregate's applicable leaves from exact supported game stat IDs. Moving a contribution between damage and cast speed, or adding/removing modifier or added-damage groups, changes the dependency set and invalidates both old and new consumers. Changing gem level invalidates effectiveness and combined base while retaining the raw added-lightning sum. Tests compare the entire result, including intrinsic, raw added, effective added and combined ranges, totals, rows, quality and individual modifier provenance, against a fresh calculation after each mutation. Tests also cover cast-speed rounding, the reference rate cap, duplicate contributions, unsupported conditions, invalid/reversed/fractional ranges, numeric failure and immutable host ownership.

Support selection is a separate input leaf from the active skill's base facts. Enabling/disabling the supported gem, changing its level or moving its source preserves cached intrinsic damage, added damage and increased totals. Damage uses its more multiplier after additive increases and before the final endpoint rounding. Cast rate reads its explicit cast-time factor of one; this support changes no cast interval or hit count. Its less-critical-chance occurrence remains visible with `appliedToSelectedHit: false` because the metric explicitly uses noncritical hits. Disabled known supports retain their raw contribution records with no applied multipliers. Unknown disabled supports, unsupported quality and unavailable support facts fail atomically.

## Feedback policy

`planCalculationGraph` validates bounded node and edge counts, verifies every referenced node exists, and plans dependencies without recursive traversal. Self-dependencies and mutual feedback return `graph.feedback-unsupported`; dependent outputs are blocked too. No previous cached value, arbitrary number of iterations or assumed fixed point is used. The supported Spark rules contain no feedback. A future feedback mechanic needs an explicit state/solver contract, convergence or failure criteria, iteration/work bounds and comparison fixtures before it can enter a successful calculation.

## Reproducible benchmark

Run `npm run build` followed by `node scripts/benchmark-selected-skill.mjs`. This host script uses the recorded PoE1 Spark client fixture (`local-client-fixture`, snapshot `poe1-spark-client-fixture-v1`) with 32 synthetic individual item contributions, one grouped added-lightning range, one level-one enabled Controlled Destruction support, level 20 Spark and explicit resistance. It measures six separate batches of 1,000 item-value, enemy-resistance, applicability, added-lightning range, support-level or support-enabled mutations. Every state is compared in full to fresh recomputation outside the timed region. There are 100 warmup updates, five timed trials, alternating full/incremental trial order and a median per path. Session creation is excluded from timing; input validation, input copies, graph reconstruction/planning and result construction are included. An accumulated DPS checksum keeps results observable. XML parsing and snapshot loading are excluded from both paths.

Recorded on November 9, 2026, Windows x64, Node 24.6.0, npm 11.5.1, engine rule revision `poe1-selected-spark-v3`, working implementation based on Git revision `52e8310ee54e0cbe94692a0656af9c0ef31515ee`:

| Batch, 1,000 updates            | Full median | Incremental median | Incremental / full |
| ------------------------------- | ----------: | -----------------: | -----------------: |
| Item damage value               |    31.84 ms |           72.64 ms |               2.28 |
| Enemy resistance                |    32.25 ms |           71.28 ms |               2.21 |
| Damage/cast-speed applicability |    31.09 ms |           73.00 ms |               2.35 |
| Added-lightning range           |    29.32 ms |           72.29 ms |               2.47 |
| Support level                   |    55.56 ms |          138.07 ms |               2.49 |
| Support enabled state           |    57.69 ms |          150.29 ms |               2.60 |

All 6,000 comparisons passed. The first applicability, support-level and support-enabled states equal their initial states, so 999 updates in each batch evaluated its derived nodes. The other three batches evaluated the nodes shown above 1,000 times each. No item, added-range, resistance or support update recalculated base facts. Added-range changes reused both percentage totals and cast rate; support changes reused both percentage totals and all added-lightning nodes.

These measurements include the final strict dataset-shape and own-field checks, signed-zero handling and bounded graph validation. They were taken on a development machine, without CPU isolation; repeated runs and batches vary.

The incremental path is slower for this small rule set: validating, capturing inputs and maintaining the dependency graph costs more than the avoided arithmetic. These numbers demonstrate selective work and correctness, not a speedup or a production latency guarantee. Both paths retain linear input-validation work. Full recomputation remains the simple default for this bounded subset. Measure larger supported workloads before investing in graph reuse, keyed contribution patches or a different invalidation representation; this benchmark does not justify expanding mechanic coverage.
