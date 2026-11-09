import test from 'node:test';
import assert from 'node:assert/strict';
import * as pob from '@exile-engine/pob';

test('PoB exposes compatibility status without pretending XML import is implemented', () => {
  assert.equal(pob.pobCompatibility.status, 'contracts-only');
  assert.equal(pob.pobCompatibility.xmlImportImplemented, false);
  assert.equal(pob.pobCompatibility.shareCodeImportImplemented, false);
  assert.deepEqual(pob.pobCompatibility.supportedGames, []);
  assert.equal('importPobXml' in pob, false);
});
