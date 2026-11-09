# @exile-engine/data-poe1

Versioned PoE1 client build catalogs and a portable, lazy catalog reader. The committed initial snapshot identifies installed build **26474023**; its manifest is the authority for the exact content snapshot ID and coverage.

```js
import { loadCatalog } from '@exile-engine/data-poe1';

const reader = await loadCatalog(readShard);
const stats = await reader.getTable('Stats');
const descriptions = await reader.getDescriptions(undefined, 'th');
```

`readShard(path)` is supplied by the application and resolves paths relative to this package's `snapshot/` assets. It returns UTF-8 text or bytes. The reader validates declared SHA-256, size/counts and record identities; it performs no filesystem or network calls. Hosts without the standard integrity primitives can inject an implementation through the optional host parameter.

The package exports `./manifest.json` and `./snapshot/*` for host-controlled asset access. Tables, available SD locales/scopes, localized base/class labels, item templates and passive graphs are loaded on demand. Call `clearCache()` to release cached tables. Missing/excluded source references remain explicit rather than invented.

Full selected catalog coverage does not imply all mechanics are implemented. See the manifest, root data-pipeline documentation and supported-mechanics document. JavaScript reader code is MIT licensed; game data retains its original attribution as described in `NOTICE.md`.
