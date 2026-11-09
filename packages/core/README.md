# @exile-engine/core

Canonical data and calculation contracts for Exile Engine. ESM JavaScript with TypeScript declarations and no runtime dependencies.

Exports include `GameId`, `SnapshotIdentity`, `CatalogRecord`, `CatalogRef`, `CatalogReader`, `SourceRef`, `StatContribution`, `Diagnostic`, `Result`, and the shared Spark input/output contracts. A contribution retains the exact game stat ID, raw value, scope, conditions and source. Repeated contributions are preserved.

`SelectedSkillInput` and `SelectedSkillCalculation` additionally preserve build and explicit configuration identities for the bounded PoE1 Spark selected-skill slice. These are portable contracts; XML adaptation lives in `pob` and calculation rules live in `poe1`.

`AddedLightningDamageContribution` retains the exact ordered spell minimum/maximum stat pair, raw values and shared source. `AddedLightningDamageTrace` separates raw, effectiveness-scaled and combined-base ranges. PoE1 normalized `SparkLevel` records include client-derived `addedDamageEffectiveness`; this does not enable added damage in the original isolated-hit API or the PoE2 slice.

`SelectedSkillSupport` preserves explicit gem selection and provenance. Optional normalized support facts live on `SparkDataset.supports`; only the PoE1 selected-skill rules interpret the reviewed Controlled Destruction record. `SelectedSkillSupportTrace` retains exact raw stat IDs, enabled effects, more/less/cast-time multipliers and source rows. These contracts do not provide an arbitrary support loader or alter the original isolated-hit API.

`SelectedSkillCriticalDataset` separates verified critical stat identities from the explicitly attributed pinned player multiplier rule. PoE1 levels retain client-derived `baseCriticalStrikeChancePercent`. `SelectedSkillCriticalTrace` reports chance/multiplier stages, critical ranges and probability-weighted expected hit means, plus modifier and source provenance. Explicit configuration selects average critical hits with ailments excluded; the earlier profile remains disabled by default. The original isolated-hit API and PoE2 arithmetic remain unchanged.

Game packages use the portable shared normalization/calculation helpers. Hosts supply data through `CatalogReader`; core never imports a dataset, Node API, filesystem or network client. Every calculated result identifies the exact snapshot and its source rows.

`SelectedLightningResistanceConfiguration` declares raw enemy resistance, a reviewed maximum profile and explicit already-active exposure candidates. `SelectedSkillResistanceTrace` separates exposure selection, uncapped/capped resistance, post-cap penetration and the shared effective damage factor. Exact penetration/exposure stat identities and pinned rule attribution live in `SelectedSkillResistanceDataset`; scenario provenance remains distinct from item modifiers. This does not add on-hit application, curses or arbitrary maximum-resistance rules.

See the root architecture and conventions documentation. Package semver is not a client build ID. Unsupported input produces explicit diagnostics; the package does not contain a full character calculator.
