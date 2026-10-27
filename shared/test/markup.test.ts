import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  appendSystemError,
  hasSystemError,
  parseScheduledEvent,
  scheduledEventSource,
  splitSystemError,
} from '../src/markup.js';

void test('scheduled events round-trip authored text through stored markup', () => {
  const occurrence = {
    name: 'Nightly "check-in" & review <today>',
    ranAt: '2026-08-24T21:00:00.000Z',
    prompt: 'Ask what worked & what did not.\nTreat <tomorrow> as a plan.',
  };

  const source = scheduledEventSource(occurrence);

  assert.equal(
    source,
    [
      '<scheduled_event name="Nightly &quot;check-in&quot; &amp; review &lt;today>" ran_at="2026-08-24T21:00:00.000Z">',
      'Ask what worked &amp; what did not.\nTreat &lt;tomorrow&gt; as a plan.',
      '</scheduled_event>',
    ].join('\n'),
  );
  assert.deepEqual(parseScheduledEvent(source), occurrence);
});

void test('scheduled event parsing rejects shapes the engine does not write', () => {
  assert.equal(
    parseScheduledEvent(
      '<scheduled_event name="Old" ran_at="2026-08-24T21:00:00.000Z" />',
    ),
    null,
  );
  assert.equal(
    parseScheduledEvent('<scheduled_event>broken</scheduled_event>'),
    null,
  );
  assert.equal(parseScheduledEvent('ordinary operator text'), null);
});

void test('system errors preserve partial output and round-trip escaped details', () => {
  const source = appendSystemError(
    'Partial answer.',
    '  Provider returned <bad> & stopped.  ',
  );

  assert.equal(
    source,
    'Partial answer.\n<system_error>Provider returned &lt;bad&gt; &amp; stopped.</system_error>',
  );
  assert.equal(hasSystemError(source), true);
  assert.deepEqual(splitSystemError(source), {
    content: 'Partial answer.',
    error: 'Provider returned <bad> & stopped.',
  });
  assert.equal(hasSystemError(`${source}\nLater text`), false);
});

void test('system errors use the fallback and bound provider detail', () => {
  assert.deepEqual(splitSystemError(appendSystemError('', '   ')), {
    content: '',
    error: 'Generation failed.',
  });
  assert.equal(
    splitSystemError(appendSystemError('', 'x'.repeat(2_001))).error?.length,
    2_000,
  );
  assert.deepEqual(splitSystemError('ordinary response'), {
    content: 'ordinary response',
    error: null,
  });
});
