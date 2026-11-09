# Architecture

Exile Engine separates immutable client facts, interpretation, and calculation rules. Its public packages are portable ESM modules; Node is used for development tooling and host-side examples.

## Dependency direction

```mermaid
flowchart TD
  P1[poe1 rules] --> C[core contracts]
  P2[poe2 rules] --> C
  IT[item-text] --> C
  POB[pob contracts] --> C
  POB --> IT
  D1[data-poe1] --> C
  D2[data-poe2] --> C
  H[host application] --> P1
  H --> P2
  H --> IT
  H --> D1
  H --> D2
```

`core` does not import game packages, datasets or adapters. The host chooses the game and exact snapshot and supplies I/O. Loading a package does not eagerly load all catalogs. The data readers verify shard sizes, checksums and row identities, cache requested tables, and expose cache clearing.

## Data and identities

`SnapshotIdentity` separates the game, installed build and content snapshot ID from npm package semver. `CatalogRecord` preserves a source row and its fields. Resolvable foreign references carry table/key/row identity; excluded or dangling relationships stay explicit source references. A stable game stat ID is retained exactly, including `%`, `+` and punctuation.

`StatContribution` represents one occurrence with its source, value, scope and any conditions. Do not prematurely reduce the input to a single value per stat ID. SD description names and export filenames are presentation identities. Numeric table positions and passive graph node IDs are distinct identities scoped to the source snapshot.

## Interpretation and calculation

The SD parser retains ordered stat groups, ranges, handlers, locales and include relationships. Item parsing emits candidates and original lines. Reconciliation selects a defensible interpretation before calculation; parsing text alone does not prove that an entire item or character is supported.

Game packages normalize only the data needed for their supported mechanic. The first normalizer reads client-authored Spark resolved damage and cast-time records. The synchronous calculator applies the explicitly implemented stat operations and returns a trace. Client facts remain separate from the formula code. No suffix-based naming heuristic supplies missing semantics.

The PoB package adapts a bounded, documented PoE1 XML subset to canonical selected-skill inputs. It retains unresolved data and emits no calculable input unless the entire imported slice is supported. It never invokes PoB. XML parsing and item-line interpretation stay outside the calculation package.

PoE1 `calculateSelectedSkill` is the fresh full-recomputation reference. A selected-skill session captures immutable dataset facts and caches base, damage increase, cast-speed increase, pre-resistance hit, post-resistance hit and cast-rate nodes. Every update validates all external input, discovers the current dependency sets, and propagates dirty leaves and changed dependency sets. Reports name the derived nodes actually evaluated. Metadata/provenance changes also invalidate result assembly. Invalid updates preserve the last accepted state.

Spell added lightning is an ordered two-stat group with shared provenance. Separate cached nodes sum raw endpoints, apply the selected level's client-derived effectiveness, and add intrinsic base damage. Changed group membership invalidates those consumers; changed gem level invalidates scaled/combined damage while retaining raw sums. Effectiveness is immutable dataset data, not an XML expression or caller modifier. The intrinsic hit contract stays distinct from the selected-skill trace of raw/effective/combined ranges.

Dependency graphs are bounded and checked before evaluation. Cyclic and feedback-dependent nodes fail with `graph.feedback-unsupported`; there is no previous-value fallback or implicit fixed-point iteration. Future feedback mechanics need a specified state model or bounded solver, convergence criteria and failure semantics before acceptance.
