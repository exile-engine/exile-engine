# @exile-engine/poe1

PoE1 rules for the initial normal Spark, noncritical single-hit calculation.

```js
import { loadSparkDataset, calculateSpark } from '@exile-engine/poe1';

const loaded = await loadSparkDataset(reader);
if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
const result = calculateSpark(
  {
    identity: reader.identity,
    gemLevel: 20,
    quality: 20,
    modifiers: [],
    effectiveLightningResistancePercent: 0,
  },
  loaded.value,
);
```

`reader` is a matching PoE1 `CatalogReader`, usually supplied by the PoE1 data package. Loading resolves actual `Spark` client records, all supported source levels and ordinary quality. The synchronous calculation uses client-resolved base damage, additive supported increased damage, cast speed and explicit effective resistance. It returns ranges before/after resistance, cast frequency and provenance. No full-build DPS is claimed.

Unsupported supports, variants, flat damage, crit, shock, conversions, conditions and local effects fail with diagnostics. See the root supported-mechanics document and executable example.
