# Security boundaries

User-supplied builds and item text are data. Runtime code never evaluates Lua, JavaScript expressions, imported formulas or module paths. The portable packages have no filesystem/network/DOM dependency and no native module, bundled executable or WASM runtime.

TypeScript types, pure functions and worker threads are not security sandboxes. A service accepting hostile workloads should run parsing/calculation in killable, least-privilege processes with wall-clock, CPU and memory limits, no credentials and only necessary read-only data. A browser worker helps responsiveness and cancellation; it is not a new trust boundary for the origin.

Item-text parsing has configurable limits for input size, line length/count, rule count and candidate count. Keep these limits active and retain diagnostics. Unknown or unsupported syntax must not become an apparently complete interpretation. Required scenario numbers and scaling divisors are validated before calculation.

Dataset readers verify declared hashes, lengths and record counts and reject unsafe shard paths. Supply a shard reader restricted to the intended snapshot directory or asset prefix. A checksum proves consistency with a trusted manifest; it does not make an attacker-supplied manifest trustworthy. Pin manifests through the host's own distribution and review process.

The PoB adapter accepts XML text only, with explicit input-size, nesting, element, attribute and text limits. DTDs, entity declarations and external entities are rejected; there is no remote resolution, URL retrieval, share-code decoding or decompression. Unknown or ambiguous mechanics remain unresolved and block a calculable selected-skill input. No package interprets imported XML attributes or custom modifiers as executable code. The one accepted custom modifier is the exact documented noncritical-mode text, matched as data.

Extraction uses separately installed tools against read-only game installations. Decoder code and its licenses are external to the engine's runtime dependency graph. Changes to schemas, extraction profiles and data snapshots require source and coverage review. CI enforces text-only Git/package contents and package dependency boundaries.
