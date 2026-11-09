# @exile-engine/poe2

PoE2 rules for Spark's Base statset, one noncritical projectile hit. This package keeps its game identity separate from PoE1 even where stat spellings match.

```js
import { loadSparkDataset, calculateSpark } from '@exile-engine/poe2';

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

`reader` must resolve the exact PoE2 snapshot. The loader follows `SparkPlayer` to its primary statset and client-resolved per-level values. Ordinary quality is retained and reported; projectile speed is not an extra hit multiplier. Cold-Infused and other variants are unsupported.

Results include noncritical damage ranges before/after explicit resistance, cast frequency, contributions and source provenance. Supports, flat damage, crit, shock, conversions, conditions and local effects require future implementations and return diagnostics.
