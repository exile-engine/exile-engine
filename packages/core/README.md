# @exile-engine/core

Canonical data and calculation contracts for Exile Engine. ESM JavaScript with TypeScript declarations and no runtime dependencies.

Exports include `GameId`, `SnapshotIdentity`, `CatalogRecord`, `CatalogRef`, `CatalogReader`, `SourceRef`, `StatContribution`, `Diagnostic`, `Result`, and the shared Spark input/output contracts. A contribution retains the exact game stat ID, raw value, scope, conditions and source. Repeated contributions are preserved.

`SelectedSkillInput` and `SelectedSkillCalculation` additionally preserve build and explicit configuration identities for the bounded PoE1 Spark selected-skill slice. These are portable contracts; XML adaptation lives in `pob` and calculation rules live in `poe1`.

Game packages use the portable shared normalization/calculation helpers. Hosts supply data through `CatalogReader`; core never imports a dataset, Node API, filesystem or network client. Every calculated result identifies the exact snapshot and its source rows.

See the root architecture and conventions documentation. Package semver is not a client build ID. Unsupported input produces explicit diagnostics; the package does not contain a full character calculator.
