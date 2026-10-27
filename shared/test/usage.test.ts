import assert from 'node:assert/strict';
import { test } from 'node:test';

import { promptTokenCount, usageSchema } from '../src/contracts.js';

function usage(input: number, cacheRead: number, cacheWrite: number) {
  return usageSchema.parse({
    input,
    output: 25,
    cacheRead,
    cacheWrite,
    cacheWrite1h: 20,
    totalTokens: input + cacheRead + cacheWrite + 25,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  });
}

void test('prompt tokens include cache reads and writes exactly once', () => {
  assert.equal(usage(100, 0, 0).cacheWrite1h, 20);
  assert.equal(promptTokenCount(usage(100, 0, 0)), 100);
  assert.equal(promptTokenCount(usage(3, 9_177, 0)), 9_180);
  assert.equal(promptTokenCount(usage(3, 0, 9_177)), 9_180);
  assert.equal(promptTokenCount(usage(3, 8_000, 1_177)), 9_180);
});
