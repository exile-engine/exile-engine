# Data pipeline

## Snapshot boundary

The data packages commit complete rows of the build catalogs selected by `scripts/profiles/build-catalogs.json`, not every unrelated client table and not every server formula. The pinned schema defines field interpretation; the profile defines gameplay relationships to follow, explicit reverse-relationship seeds, game-specific tables and excluded reference behavior.

Build catalogs cover stats/mods; bases, equipment and flask properties; active/support gems, statsets, levels, ordinary/alternate quality and costs; passives, masteries, classes and ascendancies; and related constants/tags/types. SD files retain their available scopes, locales, ordered stat groups, ranges, handlers and includes. Passive topology comes from the exact installed PSG, converted to JSON. Referenced item-template inheritance is parsed and checked for cycles. Localized base/class labels are projected separately rather than duplicating every full table per locale.

The first snapshots use installed Steam build 26474023 for PoE1 and 26476662 for PoE2. These are installed snapshots, not a promise to match the newest patch. The observed PoE1 installation had a newer update pending. Never substitute its target build ID for the installed build.

## Reproduce

Normal builds and tests use committed JSON and require no game installation or decoder. To regenerate, first build the source parser with `npm run build`.

Install the exact versions in the profile into an external tools directory, with lifecycle scripts disabled. The extraction toolchain is not a workspace dependency. Pass the absolute `node_modules/pathofexile-dat` directory as `--tool-root`:

```sh
npm run data:extract -- --game poe1 --client-root "C:/Program Files (x86)/Steam/steamapps/common/Path of Exile" --tool-root "C:/external-tools/node_modules/pathofexile-dat"
npm run data:extract -- --game poe2 --client-root "C:/Program Files (x86)/Steam/steamapps/common/Path of Exile 2" --tool-root "C:/external-tools/node_modules/pathofexile-dat"
npm run data:validate
```

Choose your own external tools path; the example path is not created automatically. Read the decoder's separate license and pinned version requirements in `THIRD_PARTY.md`. Extraction never launches Steam, updates the game, writes to the installation, or saves binary client assets in the checkout.

## Verification and provenance

The pipeline discovers indexed source paths, verifies the Steam app/build and exact schema bytes, checks table widths and joins, and records source/table/bundle hashes. Reference-following is explicit: unrestricted recursion would pull in shop, artwork and sound relationships, while forward-only traversal would miss per-level and equipment property records.

All records in each selected catalog are preserved. Available named schema fields remain data. References outside the selected gameplay closure and existing dangling client references remain explicit source references and appear in coverage. They do not become invented records. A consumer that needs an unavailable reference fails closed. Unsupported schema/layout, missing required tables, malformed structural SD or inheritance cycles stop generation.

Output is deterministic compact UTF-8 JSON for identical pinned inputs, sharded to at most 4 MiB including the manifest. The manifest records package-independent game/build/snapshot identity, profile/schema/tool provenance, source hashes, row counts, locale/SD coverage and unresolved references. Source checks are repeated before accepting output. No generation timestamps or workstation-specific absolute paths are written to the snapshot; exact source-evidence hashes remain part of its provenance.

Schema and generated snapshot JSON are excluded from formatting. Updating the parser, schema or profile can change snapshot identity; regenerate and validate the full affected snapshot rather than editing hashes or rows by hand.

## Runtime loading

Each data package exports `loadCatalog(readShard)` and `createCatalogReader(manifest, readShard)` plus its manifest and snapshot file exports. The host's shard reader returns the requested UTF-8 text or bytes relative to that snapshot. It can use filesystem reads, fetch/CDN assets or another store outside the portable library.

The catalog loads requested tables/scopes/locales lazily, checks hash/size/counts and validates record identity. Standard UTF-8 and SHA-256 host primitives are used for integrity checks; runtimes without them can supply the explicit host interface. `clearCache()` releases loaded tables. Choose and trust the manifest before loading its shards; its checksums are consistency checks, not independent source authentication.

Full data availability is separate from implemented calculation coverage. Ordinary Spark and the documented item-text slice are the initial consumers; every other catalog record remains data until its mechanics are implemented and tested.
