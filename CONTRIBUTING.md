# Contributing

Read [the conventions](docs/conventions.md), [architecture](docs/architecture.md), and the affected package README. Install the pinned tools with `npm ci --ignore-scripts`; use a feature branch, conventional commits and a pull request.

For a mechanic, include its exact game/stat IDs, source/build provenance, units, conditions, stacking and rounding rules, supported variants and independent expected results. Distinguish client-authored facts, reviewed formulas and assumptions. Preserve upstream notices for adapted code. Never claim executed PoB parity from a source-derived calculation.

Add tests for supported behavior, malformed inputs, unsupported effects and version mismatches. Update the status table and examples. Run `npm run format`, `npm run verify`, and `npm run example` before submitting. The verification commands never publish packages.

For data changes, follow the pinned [data pipeline](docs/data-pipeline.md). Commit deterministic text shards and their manifest together. Never replace a broken reference with an invented record, omit required data to make validation pass, or add binary tooling/artifacts to the checkout.
