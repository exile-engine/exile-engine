import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const tests = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(file);
    else if (entry.name.endsWith('.test.mjs')) tests.push(file);
  }
}
await collect('tests');
for (const entry of await readdir('packages', { withFileTypes: true })) {
  if (entry.isDirectory()) await collect(path.join('packages', entry.name, 'test'));
}
if (tests.length === 0) throw new Error('No tests found.');
const child = spawn(process.execPath, ['--test', ...tests.sort()], {
  stdio: 'inherit',
  shell: false,
});
child.on('error', (error) => {
  throw error;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
