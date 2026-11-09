# @exile-engine/data-poe2

Versioned PoE2 client build catalogs and a portable, lazy catalog reader. The committed initial snapshot identifies installed build **26476662**; use its manifest for the exact content snapshot identity and coverage.

```js
import { loadCatalog } from '@exile-engine/data-poe2';

const reader = await loadCatalog(readShard);
const stats = await reader.getTable('Stats');
const descriptions = await reader.getDescriptions(undefined, 'th');
```

The host supplies `readShard(path)` relative to the package's `snapshot/` assets, returning UTF-8 text or bytes. Hash, length/count and record identity checks run before records are exposed. No filesystem/network dependency is bundled. An optional host interface supports runtimes without the default integrity primitives.

`./manifest.json` and `./snapshot/*` are public asset exports. Load requested tables, SD scopes/locales, localized base/class labels, item inheritance templates or passive graphs as needed and release cached tables with `clearCache()`. Preserve explicit unresolved references and multi-statset identities.

Catalog availability is separate from implemented mechanics. The initial engine supports normal Spark's Base statset, not the full game. JavaScript reader code is MIT licensed; game data attribution is retained in `NOTICE.md`.
