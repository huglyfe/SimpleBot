import assert from 'node:assert/strict';
import { test } from 'node:test';
import { traceSchema, type Trace } from '../src/contracts.js';
import { updateTrace } from '../src/trace.js';

const tool = {
  type: 'tool' as const,
  id: 'call',
  name: 'system__calculator',
  arguments: { expression: '2+2' },
  result: null,
  isError: false,
  startedAt: '2026-09-04T12:00:00.000Z',
  completedAt: null,
};

void test('trace accepts inspection entries and rejects provider frames and the old untagged shape', () => {
  const trace = [{ type: 'reasoning', text: 'Considering.' }, tool];
  assert.deepEqual(traceSchema.parse(trace), trace);
  for (const invalid of [
    [
      {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'Native.' }],
      },
    ],
    [{ reasoning: 'Flattened.', tools: [] }],
    [{ type: 'reasoning', text: 'Readable.', thinkingSignature: 'opaque' }],
    [{ ...tool, result: 4 }],
  ])
    assert.equal(traceSchema.safeParse(invalid).success, false);
});

void test('a result updates the latest matching call without moving it or changing earlier evidence', () => {
  const earlier = { ...tool, result: '4', completedAt: tool.startedAt };
  const trace: Trace = [
    earlier,
    { type: 'reasoning', text: 'Again.' },
    tool,
    { type: 'reasoning', text: 'Waiting.' },
  ];
  const updated = updateTrace(trace, {
    type: 'tool_result',
    attemptId: '00000000-0000-4000-8000-000000000001',
    at: '2026-09-04T12:00:01.000Z',
    id: tool.id,
    name: tool.name,
    result: '8',
    isError: false,
  });
  assert.equal(updated[0], earlier);
  assert.equal(updated[3], trace[3]);
  assert.deepEqual(updated[2], {
    ...tool,
    result: '8',
    completedAt: '2026-09-04T12:00:01.000Z',
  });
  assert.equal(tool.result, null, 'prior live snapshots are immutable');
});
