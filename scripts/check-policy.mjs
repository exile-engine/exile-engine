import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const forbiddenExtensions = new Set(
  '.exe .dll .so .dylib .node .wasm .bin .ggpk .dat .datc64 .psg .zip .tgz .gz .7z .rar .tar .png .jpg .jpeg .gif .webp .ico .dds .woff .woff2 .ttf .otf .mp3 .ogg .wav .mp4 .webm .pdf .docx .xlsx .sqlite .db'.split(
    ' ',
  ),
);
const dependencyGraph = {
  core: [],
  poe1: ['core'],
  poe2: ['core'],
  'item-text': ['core'],
  pob: ['core', 'item-text'],
  'data-poe1': ['core'],
  'data-poe2': ['core'],
};

export function validateTextFile(name, bytes) {
  if (forbiddenExtensions.has(path.extname(name).toLowerCase())) {
    throw new Error(`Forbidden binary/archive/media extension: ${name}`);
  }
  if (bytes.includes(0)) throw new Error(`NUL byte in source-only file: ${name}`);
  let source;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`Invalid UTF-8 in source-only file: ${name}`);
  }
  if (/data:application\/(?:wasm|octet-stream);base64,/i.test(source)) {
    throw new Error(`Embedded binary payload: ${name}`);
  }
  if (name.includes('/snapshot/') && bytes.length > 4 * 1024 * 1024) {
    throw new Error(`Snapshot file exceeds the 4 MiB limit: ${name}`);
  }
  return source;
}

export function validateRuntimeSource(name, source, allowedPackages) {
  const imports = source.matchAll(/\b(?:from\s*|import\s*\(\s*|import\s*)['"]([^'"]+)['"]/g);
  for (const [, specifier] of imports) {
    if (specifier.startsWith('.')) continue;
    if (!allowedPackages.includes(specifier)) {
      throw new Error(`Undeclared or platform-specific runtime import in ${name}: ${specifier}`);
    }
  }
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  if (/\b(?:fetch|require|eval|Function)\s*\(/.test(code)) {
    throw new Error(`I/O or dynamic code execution in portable runtime: ${name}`);
  }
  if (/\b(?:Buffer|process|document|window|Deno|Bun)\s*\./.test(code)) {
    throw new Error(`Platform-specific global in portable runtime: ${name}`);
  }
}

export async function checkPolicy() {
  const names = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    },
  )
    .split('\0')
    .filter(Boolean);
  for (const name of names) {
    const bytes = await readFile(path.join(root, name));
    const source = validateTextFile(name, bytes);
    const match = /^packages\/([^/]+)\/src\/.*\.ts$/.exec(name);
    if (match) {
      const allowed = dependencyGraph[match[1]];
      if (!allowed) throw new Error(`Unknown workspace: ${match[1]}`);
      validateRuntimeSource(
        name,
        source,
        allowed.map((dep) => `@exile-engine/${dep}`),
      );
    }
  }
  const packages = await readdir(path.join(root, 'packages'), { withFileTypes: true });
  for (const folder of packages.filter((entry) => entry.isDirectory())) {
    const pkg = JSON.parse(
      await readFile(path.join(root, 'packages', folder.name, 'package.json'), 'utf8'),
    );
    const allowed = dependencyGraph[folder.name].map((name) => `@exile-engine/${name}`);
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      if (!allowed.includes(name)) throw new Error(`Unapproved runtime dependency: ${name}`);
    }
  }
  console.log(`Source-only policy passed: ${names.length} files, ${packages.length} workspaces.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkPolicy();
}
