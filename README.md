# Exile Engine

Portable TypeScript libraries for Path of Exile 1 and 2 calculations and locale-aware item text. The canonical data layer uses real game stat IDs, including punctuation, rather than PoB's internal modifier names.

This first release calculates **ordinary Spark, one noncritical projectile hit**. It also parses and reconciles an English/Thai wand example and renders equivalent modifier text in the other locale. The data packages contain full snapshots of the selected build catalogs; that does not imply support for every mechanic in those catalogs.

The PoE1 selected-skill slice additionally accepts ordered spell added-lightning ranges, applies client-derived effectiveness and retains raw/scaled/combined damage provenance. Its XML fixtures are compared with an executed pinned PoB oracle; full and incremental paths are checked against each other. Other damage elements, attacks, supports and conditional effects remain outside this slice.

## Packages

| Package                   | Responsibility                                                                      | Initial status                |
| ------------------------- | ----------------------------------------------------------------------------------- | ----------------------------- |
| `@exile-engine/core`      | Canonical contributions, snapshot identities, diagnostics and calculation contracts | Working                       |
| `@exile-engine/poe1`      | PoE1 rules and Spark normalization/calculation                                      | Normal Spark single-hit slice |
| `@exile-engine/poe2`      | PoE2 rules and Spark normalization/calculation                                      | Spark Base statset slice      |
| `@exile-engine/item-text` | SD parsing, item-text candidates, reconciliation and formatting                     | English/Thai slice tested     |
| `@exile-engine/pob`       | Bounded PoE1 PoB XML adaptation                                                     | Synthetic normal Spark subset |
| `@exile-engine/data-poe1` | Versioned PoE1 build catalogs, descriptions, passive topology and item templates    | Installed build snapshot      |
| `@exile-engine/data-poe2` | Versioned PoE2 build catalogs, descriptions, passive topology and item templates    | Installed build snapshot      |

All packages start at `0.1.0`. They are prepared for public npm publication but have **not been published** by the scaffold task. The monorepo root is private.

## Develop

Use Node.js 24 or newer and npm 11.5.1 or newer:

```sh
npm ci --ignore-scripts
npm run verify
npm run example
npm run example:pob
npm run test:browser:headless
npm run benchmark:selected
```

The package source compiles to ESM JavaScript and declarations with the JavaScript TypeScript 6 compiler (`tsc6`). No bundler or native compiler is installed by this workspace. Compiled output is untracked; library consumers receive emitted JavaScript, not a requirement to execute TypeScript source.

`npm run verify` checks formatting, builds and tests the libraries, validates committed snapshots, enforces the source-only/dependency policy and tests actual package archives in a separate temporary consumer. It does not publish packages or launch either game.

## Runtime model

The application supplies snapshot I/O. Load the matching dataset, normalize Spark once with `loadSparkDataset(reader)`, and call `calculateSpark(input, dataset)` synchronously. The game package returns a discriminated result with diagnostics, source rows and an arithmetic breakdown. Inputs include the exact snapshot identity and an explicit effective enemy lightning resistance.

Keep a copied item's unresolved lines and candidate mappings until reconciliation is complete. A successful modifier match does not establish a complete equipment model. `@exile-engine/pob` imports a bounded synthetic PoE1 XML subset; unsupported or ambiguous data blocks a calculable input. PoE1 additionally exposes fresh and incremental selected-skill hit/combined DPS for normal Spark, counting one noncritical lightning hit per cast. See the [executed pinned reference comparison](docs/pob-reference.md); no full-build parity is claimed.

See the executable [Spark example](examples/spark.mjs), [architecture](docs/architecture.md), [conventions](docs/conventions.md), [data pipeline](docs/data-pipeline.md), [supported mechanics](docs/supported-mechanics.md), [security boundaries](docs/security.md), and [roadmap](docs/roadmap.md).

The [initial validation record](docs/validation.md) documents the tested runtimes, snapshot coverage, deterministic extraction identities and preserved source exceptions.

## Source-only repository

Git and npm package contents contain text only. Native executables/libraries, WASM, game archives, raw binary tables, media and encoded binary payloads are excluded. The optional offline decompressor is installed **outside this checkout**, is never part of a runtime package, and is independently licensed. Existing Node.js and Git installations are development prerequisites, not vendored repository files.

Project code is [MIT licensed](LICENSE). [Third-party notices](THIRD_PARTY.md) distinguish code licenses from Grinding Gear Games data attribution. Exile Engine is an independent project.
