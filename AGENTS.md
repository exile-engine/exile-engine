# Exile Engine agent guide

## Project and commands

- Seven npm workspaces under `packages/`; the root is private. ESM-only, strict TypeScript, ES2022 output. Develop with Node 24+ and npm 11.5.1+.
- Use `npm ci --ignore-scripts`, `npm run build`, `npm test`, `npm run data:validate`, `npm run check:policy`, `npm run check:packages`, and `npm run verify`.
- The compiler executable is **`tsc6`**, from pinned `@typescript/typescript6`. Do not replace it with a native TypeScript compiler or add a native bundler.
- Root TypeScript project references mirror the runtime dependency graph. Use real package imports, never TypeScript `paths` aliases that bypass package boundaries.

## Invariants

- Exact game stat IDs are the authored data vocabulary. Preserve punctuation, source identities, ordered multi-stat groups, individual contributions and their provenance. A display label, description alias, row index or PoB internal modifier name is not a replacement stat ID.
- Preserve game/build/snapshot identities across adapters and calculations. Never combine versions or games implicitly.
- Catalog coverage and implemented calculation coverage are separate. Unsupported or ambiguous inputs must remain visible; never return a zero/empty placeholder as a successful calculation or import.
- Runtime packages contain no Node, filesystem, network, DOM, Lua or native runtime dependency. Hosts supply snapshot readers and may supply required web-standard primitives explicitly.
- Never evaluate input code, formulas, Lua, XML expressions or arbitrary module paths. See `docs/security.md` for work limits and isolation boundaries.

## Source-only policy

- Commit UTF-8 text only. No DLL/EXE/native module/WASM, archives, raw binary game files, images/audio/fonts, databases, or encoded binary blobs.
- Keep extractor dependencies outside the checkout. Only pinned profiles, schemas, scripts and JSON snapshots belong here. Do not add extraction tools to package runtime dependencies.
- Keep `node_modules/`, `dist/`, build-info files and disposable `temp/` output untracked. Archive/package smoke tests write binary archives to system temporary storage outside this repository.
- Every snapshot shard, including the manifest, is capped at 4 MiB. Preserve exact pinned schema bytes; generated snapshots and schema JSON are excluded from formatting.
- Do not fetch latest data during a build, install hook or calculation. Snapshot regeneration is an explicit offline command against verified inputs.

## Workflow

- Read `docs/architecture.md`, `docs/conventions.md` and the affected package README before changing public behavior. Read `docs/data-pipeline.md` before changing extraction or snapshot contracts.
- Put scratch text, probes and logs in repository `temp/`. Never store raw binary client assets there.
- Add behavior tests with Node's built-in runner. Tests import emitted package entry points. Keep rules pure and inputs readonly; validate external input at runtime.
- Run focused checks during work, then `npm run verify` and the executable example. Update supported-mechanics documentation when coverage changes.
- Use conventional commit prefixes. Publishing packages, adding credentials, changing organization access and live services require explicit task authorization; ordinary background builds never publish anything.
