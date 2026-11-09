import { readFile } from 'node:fs/promises';
import { runSelectedSparkDemo } from './selected-spark-demo.mjs';

console.log(
  JSON.stringify(
    await runSelectedSparkDemo(
      (relative) =>
        readFile(new URL(`../packages/data-poe1/snapshot/${relative}`, import.meta.url)),
      (name) => readFile(new URL(`../tests/fixtures/pob/${name}.xml`, import.meta.url), 'utf8'),
    ),
    null,
    2,
  ),
);
