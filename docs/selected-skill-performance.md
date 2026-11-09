# Selected Spark recomputation and performance

`calculateSelectedSkill` is the fresh reference path. It validates every input and dataset fact and recalculates all supported operations. `createSelectedSkillSession` captures its own immutable dataset and accepted input, validates every proposed update, and reuses derived values whose dependencies did not change. Rejected updates leave the last accepted calculation and graph intact. A session cannot change game, build or snapshot; create another session for another dataset.

The seven derived nodes are `base`, `damage-increase`, `cast-speed-increase`, `damage-before-resistance`, `damage-after-resistance`, `cast-rate` and `selected-skill`. The final node assembles the complete trace and selected hit/combined DPS. Reports expose the actual dependency record and derived nodes evaluated in dependency order. Input comparisons and validation run on every update and are excluded from `recalculated`.

| Change                                           | Derived nodes evaluated                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Applicable damage modifier value                 | Damage increase, damage before resistance, damage after resistance, selected skill |
| Explicit enemy resistance                        | Damage after resistance, selected skill                                            |
| Configuration ID only                            | Selected skill                                                                     |
| Damage modifier changes into cast-speed modifier | Both increase totals, cast rate, damage before/after resistance, selected skill    |
| Selected gem level or quality                    | Base, damage before/after resistance, cast rate, selected skill                    |
| Identical input                                  | None                                                                               |

Each contribution remains a separate input leaf identified by its array position. Reordering contributions may cause extra work. On every update the graph derives each aggregate's applicable leaves from exact supported game stat IDs. Moving a contribution between damage and cast speed, or adding/removing contributions, changes the dependency set and invalidates both old and new consumers. Tests compare the entire result, including intermediate ranges, totals, rows, quality and individual modifier provenance, against a fresh calculation after each mutation. Tests also cover cast-speed rounding, the reference rate cap, duplicate contributions, unsupported conditions, numeric failure and immutable host ownership.

## Feedback policy

`planCalculationGraph` validates bounded node and edge counts, verifies every referenced node exists, and plans dependencies without recursive traversal. Self-dependencies and mutual feedback return `graph.feedback-unsupported`; dependent outputs are blocked too. No previous cached value, arbitrary number of iterations or assumed fixed point is used. The supported Spark rules contain no feedback. A future feedback mechanic needs an explicit state/solver contract, convergence or failure criteria, iteration/work bounds and comparison fixtures before it can enter a successful calculation.

## Reproducible benchmark

Run `npm run build` followed by `node scripts/benchmark-selected-skill.mjs`. This host script uses the recorded PoE1 Spark client fixture (`local-client-fixture`, snapshot `poe1-spark-client-fixture-v1`) with 32 synthetic individual item contributions, level 20 and explicit resistance. It measures three separate batches of 1,000 item-value, enemy-resistance or applicability mutations. Every state is compared in full to fresh recomputation outside the timed region. There are 100 warmup updates, five timed trials, alternating full/incremental trial order and a median per path. Session creation is excluded from timing; input validation, input copies, graph reconstruction/planning and result construction are included. An accumulated DPS checksum keeps results observable. XML parsing and snapshot loading are excluded from both paths.

Recorded on November 9, 2026, Windows x64, Node 24.6.0, npm 11.5.1, engine rule revision `poe1-selected-spark-v1`, working implementation based on Git revision `a642eea0ba4995504e54e28b28ad11562dd7c5c4`:

| Batch, 1,000 updates            | Full median | Incremental median | Incremental / full |
| ------------------------------- | ----------: | -----------------: | -----------------: |
| Item damage value               |    16.88 ms |           66.22 ms |               3.92 |
| Enemy resistance                |    15.09 ms |           60.42 ms |               4.01 |
| Damage/cast-speed applicability |    15.16 ms |           60.19 ms |               3.97 |

All 3,000 comparisons passed. The first applicability state equals the initial state, so 999 updates evaluated its derived nodes. The other two batches evaluated the nodes shown above 1,000 times each. No item or resistance update recalculated base facts.

These measurements include the final strict dataset-shape checks, signed-zero handling and bounded graph validation. They were taken on a development machine, without CPU isolation; repeated runs vary.

The incremental path is slower for this small rule set: validating, capturing inputs and maintaining the dependency graph costs more than the avoided arithmetic. These numbers demonstrate selective work and correctness, not a speedup or a production latency guarantee. Both paths retain linear input-validation work. Full recomputation remains the simple default for this bounded subset. Measure larger supported workloads before investing in graph reuse, keyed contribution patches or a different invalidation representation; this benchmark does not justify expanding mechanic coverage.
