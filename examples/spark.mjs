import { readFile } from 'node:fs/promises';
import { runSparkDemo } from './spark-demo.mjs';

for (const game of ['poe1', 'poe2']) {
  const root = new URL(`../packages/data-${game}/snapshot/`, import.meta.url);
  const result = await runSparkDemo(game, (relative) => {
    const source = new URL(relative, root);
    if (!source.href.startsWith(root.href))
      throw new Error('Source escaped the selected snapshot.');
    return readFile(source);
  });
  console.log(JSON.stringify(result, null, 2));
}
