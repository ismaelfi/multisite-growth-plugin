import test from 'node:test';
import assert from 'node:assert/strict';
import { percentageChange } from '../lib/metrics.js';
test('zero-baseline growth remains undefined and missing numbers stay missing', () => {
  assert.equal(percentageChange(1,0),null);
  assert.equal(percentageChange(0,0),0);
  assert.equal(percentageChange(0,10),-100);
  assert.equal(percentageChange(15,10),50);
  assert.equal(percentageChange(null,10),null);
});
