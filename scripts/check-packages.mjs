import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTextFile } from './check-policy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this check through npm run check:packages.');
const npm = (args, cwd = root) =>
  execFileSync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
const packages = (await readdir(path.join(root, 'packages'), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const temporary = await mkdtemp(path.join(os.tmpdir(), 'exile-engine-consumer-'));

try {
  const archives = [];
  for (const name of packages) {
    const folder = path.join(root, 'packages', name);
    const report = JSON.parse(npm(['pack', '--dry-run', '--json', '--ignore-scripts'], folder))[0];
    if (!report.files.some((file) => file.path === 'dist/index.js')) {
      throw new Error(`Package has no emitted entry point: ${name}`);
    }
    for (const file of report.files) {
      if (
        /^(?:temp|test|tests|node_modules)\//.test(file.path) ||
        file.path.endsWith('.tsbuildinfo')
      ) {
        throw new Error(`Development material would be published: ${name}/${file.path}`);
      }
      validateTextFile(file.path, await readFile(path.join(folder, file.path)));
    }
    const packed = JSON.parse(
      npm(['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], folder),
    )[0];
    archives.push(path.join(temporary, packed.filename));
    console.log(`${report.name}: ${report.files.length} text files, ${report.unpackedSize} bytes.`);
  }

  await writeFile(
    path.join(temporary, 'package.json'),
    JSON.stringify({ name: 'exile-engine-consumer-check', private: true, type: 'module' }) + '\n',
  );
  npm(
    ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', ...archives],
    temporary,
  );
  const imports = packages
    .map((name, index) => `import * as package${index} from '@exile-engine/${name}';`)
    .join('\n');
  const program = `${imports}\nconsole.log([${packages.map((_, index) => `Object.keys(package${index}).length`).join(',')}]);\n`;
  await writeFile(path.join(temporary, 'consumer.mjs'), program);
  await writeFile(path.join(temporary, 'consumer.ts'), program);
  execFileSync(process.execPath, ['consumer.mjs'], { cwd: temporary, stdio: 'inherit' });
  execFileSync(
    process.execPath,
    [
      path.join(root, 'node_modules/@typescript/typescript6/bin/tsc6'),
      '--strict',
      '--target',
      'ES2022',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--noEmit',
      'consumer.ts',
    ],
    { cwd: temporary, stdio: 'inherit' },
  );
  console.log(
    'Isolated package imports and TypeScript declarations passed. No packages published.',
  );
} finally {
  // The target is an exact mkdtemp result under the system temporary directory.
  const resolved = path.resolve(temporary);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
    throw new Error('Refusing to remove a path outside system temporary storage.');
  }
  await rm(resolved, { recursive: true, force: true });
}
