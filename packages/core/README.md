# @exile-engine/core

Canonical data and calculation contracts for Exile Engine. ESM JavaScript with TypeScript declarations and no runtime dependencies.

Exports include `GameId`, `SnapshotIdentity`, `CatalogRecord`, `CatalogRef`, `CatalogReader`, `SourceRef`, `StatContribution`, `Diagnostic`, `Result`, and the shared Spark input/output contracts. A contribution retains the exact game stat ID, raw value, scope, conditions and source. Repeated contributions are preserved.

`SelectedSkillInput` and `SelectedSkillCalculation` additionally preserve build and explicit configuration identities for the bounded PoE1 Spark selected-skill slice. These are portable contracts; XML adaptation lives in `pob` and calculation rules live in `poe1`.

`AddedLightningDamageContribution` retains the exact ordered spell minimum/maximum stat pair, raw values and shared source. `AddedLightningDamageTrace` separates raw, effectiveness-scaled and combined-base ranges. PoE1 normalized `SparkLevel` records include client-derived `addedDamageEffectiveness`; this does not enable added damage in the original isolated-hit API or the PoE2 slice.

`SelectedSkillSupport` preserves explicit gem selection and provenance. Optional normalized support facts live on `SparkDataset.supports` as a closed union of the reviewed Controlled Destruction and Faster Casting profiles, with their distinct level schemas. `SelectedSkillSupportTrace` retains exact raw stat IDs, enabled effects, a separate increased-cast-speed subtotal, more/less/cast-time multipliers and source rows. Contribution flags distinguish hit effects from cast-rate effects. Selected `hit.increasedCastSpeedPercent` combines item and support speed; original item and gem contributions retain separate provenance. These contracts do not provide an arbitrary support loader or alter the original isolated-hit API.

`SelectedSkillCriticalDataset` separates verified critical stat identities from the explicitly attributed pinned player multiplier rule. PoE1 levels retain client-derived `baseCriticalStrikeChancePercent`. `SelectedSkillCriticalTrace` reports chance/multiplier stages, critical ranges and probability-weighted expected hit means, plus modifier and source provenance. Explicit configuration selects average critical hits with an excluded or configured-shock ailment policy; the earlier profile remains disabled by default. The original isolated-hit API and PoE2 arithmetic remain unchanged.

Game packages use the portable shared normalization/calculation helpers. Hosts supply data through `CatalogReader`; core never imports a dataset, Node API, filesystem or network client. Every calculated result identifies the exact snapshot and its source rows.

`SelectedLightningResistanceConfiguration` declares raw enemy resistance, a reviewed maximum profile, explicit already-active exposure candidates and optional configured Conductivity. `SelectedSkillResistanceTrace` separates exposure selection, Conductivity scaling, uncapped/capped resistance, post-cap penetration and the shared effective damage factor. Exact penetration/exposure stat identities and pinned rule attribution live in `SelectedSkillResistanceDataset`; scenario provenance remains distinct from item modifiers. On-hit application, other curses and arbitrary maximum-resistance rules remain unsupported.

`SelectedConductivityConfiguration` preserves one normal curse's level/enabled state and explicit increased effect, with separate scenario sources for curse and effect. `SelectedConductivityDataset` retains same-snapshot gem/stat/type facts, source rows and attributed scaling rules. Its trace records raw/scaled/rounded/truncated/applied resistance and the excluded shock-chance side effect. Duration and radius remain source facts; no curse casts, uptime or generated ailments are inferred. Conductivity requires the raw resistance profile and an explicit ailment policy.

`SelectedShockConfiguration` declares one external enemy shock magnitude and hit uptime with scenario provenance under the explicit configured-shock policy. `SelectedSkillShockDataset` separates the exact shock damage-taken vocabulary from pinned formula provenance. `SelectedSkillShockTrace` owns unshocked/shocked and weighted expected means, factors and the scenario contribution. It does not infer shock from Spark hits, crits or ailment effects.

See the root architecture and conventions documentation. Package semver is not a client build ID. Unsupported input produces explicit diagnostics; the package does not contain a full character calculator.
