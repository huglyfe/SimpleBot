import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calculate } from './calculator.js';

test('calculator evaluates bounded arithmetic without code execution', () => {
  assert.equal(calculate('2 + 3 * 4'), 14);
  assert.equal(calculate('2 ^ 3 ^ 2'), 512);
  assert.equal(calculate('-(2 + 3) ^ 2'), -25);
  assert.equal(calculate('1.5e2 % 40'), 30);
  assert.throws(() => calculate('1 / 0'), /Division by zero/u);
  assert.throws(() => calculate('process.exit()'), /Expected a number/u);
});
