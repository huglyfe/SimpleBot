import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fauxAssistantMessage, type Usage } from '@earendil-works/pi-ai';

import { attemptContextOverflow } from './attempts.js';

function usage(
  input: number,
  cacheRead: number,
  cacheWrite: number,
  output: number,
): Usage {
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + cacheRead + cacheWrite + output,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

test('context overflow counts cache writes as prompt tokens', () => {
  const silent = {
    ...fauxAssistantMessage('Accepted'),
    usage: usage(3, 0, 98, 10),
  };
  assert.equal(attemptContextOverflow(silent, 100), true);

  const filled = {
    ...fauxAssistantMessage('', { stopReason: 'length' }),
    usage: usage(3, 0, 96, 0),
  };
  assert.equal(attemptContextOverflow(filled, 100), true);

  const ordinaryLength = {
    ...fauxAssistantMessage('Partial', { stopReason: 'length' }),
    usage: usage(3, 90, 0, 6),
  };
  assert.equal(attemptContextOverflow(ordinaryLength, 100), false);
});
