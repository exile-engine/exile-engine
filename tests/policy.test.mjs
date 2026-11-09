import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRuntimeSource, validateTextFile } from '../scripts/check-policy.mjs';

test('source-only policy rejects native files, invalid text, and embedded binary assets', () => {
  assert.throws(() => validateTextFile('x.dll', Buffer.from('text')), /Forbidden/);
  assert.throws(() => validateTextFile('x.ts', Buffer.from([0])), /NUL/);
  assert.throws(() => validateTextFile('x.ts', Buffer.from([255])), /UTF-8/);
  assert.throws(
    () =>
      validateTextFile('x.js', Buffer.from(['data:application/wasm', ';base64,example'].join(''))),
    /Embedded/,
  );
  assert.equal(validateTextFile('x.ts', Buffer.from('export const x = 1;')), 'export const x = 1;');
});

test('portable runtime policy rejects Node imports and executable or network input paths', () => {
  assert.throws(() => validateRuntimeSource('x.ts', "import fs from 'node:fs';", []), /import/);
  assert.throws(() => validateRuntimeSource('x.ts', "fetch('https://example.com');", []), /I\/O/);
  assert.throws(() => validateRuntimeSource('x.ts', 'eval(input);', []), /execution/);
  assert.throws(() => validateRuntimeSource('x.ts', 'process.env.SECRET;', []), /global/);
  validateRuntimeSource('x.ts', "import type { GameId } from '@exile-engine/core';", [
    '@exile-engine/core',
  ]);
});
