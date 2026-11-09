import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const candidates = process.env.EXILE_ENGINE_BROWSER
  ? [process.env.EXILE_ENGINE_BROWSER]
  : process.platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      ]
    : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
let executable;
for (const candidate of candidates) {
  try {
    await access(candidate);
    executable = candidate;
    break;
  } catch {}
}
if (!executable) throw new Error('Set EXILE_ENGINE_BROWSER to an installed Chromium executable.');

const port = Number(process.env.EXILE_ENGINE_SMOKE_PORT || 4789);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid smoke port.');
const profile = await mkdtemp(path.join(os.tmpdir(), 'exile-engine-browser-'));
const server = spawn(process.execPath, ['scripts/browser-smoke-server.mjs'], {
  cwd: root,
  env: { ...process.env, EXILE_ENGINE_SMOKE_PORT: String(port) },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let browser;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Browser smoke server did not start.')), 10000);
    server.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited ${code}.`));
    });
    server.stdout.on('data', (bytes) => {
      if (bytes.toString().includes('Browser smoke test:')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on('data', (bytes) => process.stderr.write(bytes));
  });
  const stdout = [];
  const stderr = [];
  browser = spawn(
    executable,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--disable-extensions',
      '--disable-default-apps',
      '--disable-crash-reporter',
      '--disable-breakpad',
      `--user-data-dir=${profile}`,
      '--dump-dom',
      '--timeout=90000',
      '--virtual-time-budget=90000',
      `http://127.0.0.1:${port}/`,
    ],
    { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  browser.stdout.on('data', (bytes) => stdout.push(bytes));
  browser.stderr.on('data', (bytes) => stderr.push(bytes));
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      browser.kill();
      reject(new Error('Browser smoke timed out.'));
    }, 110000);
    browser.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    browser.once('close', (status) => {
      clearTimeout(timer);
      resolve(status);
    });
  });
  const dom = Buffer.concat(stdout).toString('utf8');
  await mkdir(path.join(root, 'temp'), { recursive: true });
  await writeFile(path.join(root, 'temp/browser-smoke.html'), dom);
  await writeFile(path.join(root, 'temp/browser-smoke.log'), Buffer.concat(stderr));
  const status = /<p id="status">([^<]*)<\/p>/.exec(dom)?.[1];
  if (
    code !== 0 ||
    !status?.startsWith('PASS:') ||
    !dom.includes('"incrementalEqualsFull": true')
  ) {
    throw new Error(
      `Browser smoke failed (exit ${code}): ${status ?? 'No result status'}. See temp/browser-smoke.html and temp/browser-smoke.log.`,
    );
  }
  console.log(status);
} finally {
  browser?.kill();
  server.kill();
  const temporaryRoot = path.resolve(os.tmpdir()) + path.sep;
  const resolvedProfile = path.resolve(profile);
  if (
    !resolvedProfile.startsWith(temporaryRoot) ||
    !path.basename(profile).startsWith('exile-engine-browser-')
  ) {
    throw new Error('Refusing cleanup outside the dedicated system temporary profile.');
  }
  await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
