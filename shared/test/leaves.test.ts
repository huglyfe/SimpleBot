import assert from 'node:assert/strict';
import { test } from 'node:test';

import { committedLeafSchema } from '../src/contracts.js';

void test('client leaves require a committed summary and exclude frozen source', () => {
  const leaf = {
    id: '00000000-0000-4000-8000-000000000000',
    triggerPositionId: '00000000-0000-4000-8000-000000000001',
    startOrdinal: 0,
    endOrdinal: 4,
    createdAt: '2026-08-20T12:00:00.000Z',
    state: 'committed',
    summary: 'Earlier conversation',
    summaryOutcome: 'model',
  };
  assert.equal(committedLeafSchema.safeParse(leaf).success, true);
  for (const invalid of [
    { ...leaf, state: 'pending', summary: null },
    { ...leaf, summary: null },
    { ...leaf, source: 'Frozen transcript' },
  ]) {
    assert.equal(committedLeafSchema.safeParse(invalid).success, false);
  }
});
