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
