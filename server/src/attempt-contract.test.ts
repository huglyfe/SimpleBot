import {
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from '@earendil-works/pi-ai';
import {
  sessionChangeSchema,
  sessionProjectionSchema,
  updateTrace,
  type SessionChange,
  type SessionProjection,
  type Trace,
} from '@simplebot/shared';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import {
  disposeTestFixture,
  createSession,
  createTestFixture,
  listen,
  readEvents,
  reopenTestFixture,
  streamAttempt,
} from './test-helper.js';

test('SSE trace survives swipes and restart while reasoning stays out of later context, search, and compaction', async (context) => {
  const fixture = await createTestFixture();
  let runtime = fixture.runtime;
  context.after(() => runtime.close());
  const presetPath = join(fixture.root, 'presets/default.json');
  const preset = JSON.parse(await readFile(presetPath, 'utf8')) as Record<
    string,
    unknown
  >;
  preset.context = { thresholdTokens: 1_000_000, liveTailExchanges: 1 };
  await writeFile(presetPath, JSON.stringify(preset));
  fixture.faux.setResponses([
    fauxAssistantMessage(
      [
        fauxText('Let me calculate.\n\n'),
        fauxThinking('Privatetrace before.'),
        fauxToolCall(
          'system__calculator',
          { expression: '2+2' },
          { id: 'first' },
        ),
        fauxThinking('Privatetrace between.'),
        fauxToolCall(
          'system__calculator',
          { expression: 'invalid' },
          { id: 'second' },
        ),
      ],
      { stopReason: 'toolUse' },
    ),
    (input) => {
      assert.match(
        JSON.stringify(input.messages),
        /Privatetrace before/u,
        'native reasoning stays in this attempt',
      );
      return fauxAssistantMessage([
        fauxThinking('Privatetrace after.'),
        fauxText('Canonical answer.'),
      ]);
    },
    (input) => {
      assert.doesNotMatch(JSON.stringify(input), /Privatetrace/u);
      return fauxAssistantMessage([
        fauxThinking('Swipetrace only.'),
        fauxText('Alternate answer.'),
      ]);
    },
    (input) => {
      assert.doesNotMatch(
        JSON.stringify(input),
        /Privatetrace|Swipetrace|Alternate answer/u,
      );
      assert.match(JSON.stringify(input), /Canonical answer/u);
      return fauxAssistantMessage('Next answer.');
    },
    (input) => {
      assert.doesNotMatch(
        JSON.stringify(input),
        /Privatetrace|Swipetrace|Alternate answer/u,
      );
      assert.match(JSON.stringify(input), /Canonical answer/u);
      return fauxAssistantMessage('Canonical summary.');
    },
  ]);
  let address = await listen(runtime);
  const sessionId = await createSession(address);
  const events = await readEvents(
    await streamAttempt(address, sessionId, {
      kind: 'reply',
      text: 'Calculate.',
    }),
  );
  const first = finalAssistant(await projection(address, sessionId));
  assert.equal(first.variant.source, 'Let me calculate.\n\nCanonical answer.');
  assert.equal(
    first.variant.source,
    events
      .flatMap((event) => (event.type === 'text_delta' ? [event.delta] : []))
      .join(''),
  );
  const trace = first.variant.trace;
  assert.deepEqual(
    trace,
    events.reduce<Trace>(updateTrace, []),
    'completion must not reorder or replace streamed evidence',
  );
  assert.deepEqual(
    trace.map((entry) =>
      entry.type === 'reasoning' ? entry.text : entry.name,
    ),
    [
      'Privatetrace before.',
      'system__calculator',
      'Privatetrace between.',
      'system__calculator',
      'Privatetrace after.',
    ],
  );
  const tools = trace.filter((entry) => entry.type === 'tool');
  assert.equal(tools[0]?.result, '4');
  assert.equal(tools[0].isError, false);
  assert.equal(tools[1]?.isError, true);
  assert.ok(tools.every((tool) => tool.completedAt !== null));
  await readEvents(
    await streamAttempt(address, sessionId, {
      kind: 'swipe',
      positionId: first.id,
    }),
  );
  const swipe = finalAssistant(await projection(address, sessionId));
  assert.equal(swipe.variantCount, 2);
  assert.deepEqual(swipe.variant.trace, [
    { type: 'reasoning', text: 'Swipetrace only.' },
  ]);
  await runtime.close();
  runtime = (
    await reopenTestFixture({ root: fixture.root, faux: fixture.faux })
  ).runtime;
  address = await listen(runtime);
  assert.deepEqual(
    finalAssistant(await projection(address, sessionId)).variant,
    swipe.variant,
  );
  await mutate(
    address,
    `/api/sessions/${sessionId}/positions/${first.id}/selection`,
    'PATCH',
    { direction: 'previous' },
  );
  assert.deepEqual(
    finalAssistant(await projection(address, sessionId)).variant,
    first.variant,
  );
  await readEvents(
    await streamAttempt(address, sessionId, {
      kind: 'reply',
      text: 'Continue.',
    }),
  );
  const compacted = await fetch(
    `${address}/api/sessions/${sessionId}/compact`,
    { method: 'POST' },
  );
  assert.equal(compacted.status, 204);
  assert.equal(
    fixture.faux.getPendingResponseCount(),
    0,
    'the summary input was checked',
  );
  for (const query of ['Privatetrace', 'Swipetrace']) {
    const response = await fetch(`${address}/api/search?q=${query}`);
    assert.deepEqual(await response.json(), { results: [] });
  }
});

for (const stopReason of ['error', 'aborted'] as const) {
  test(`${stopReason} preserves partial reasoning and a tool without a result`, async (context) => {
    const fixture = await createTestFixture();
    context.after(() => fixture.runtime.close());
    fixture.faux.setResponses([
      fauxAssistantMessage(
        [
          fauxThinking('Partial thought.'),
          fauxToolCall('system__calculator', { expression: '2+2' }),
          fauxThinking('Interrupted thought.'),
          fauxText('Partial answer.'),
        ],
        { stopReason, errorMessage: 'Interrupted provider.' },
      ),
    ]);
    const address = await listen(fixture.runtime);
    const sessionId = await createSession(address);
    const events = await readEvents(
      await streamAttempt(address, sessionId, { kind: 'reply', text: 'Go.' }),
    );
    const position = finalAssistant(await projection(address, sessionId));
    assert.deepEqual(
      position.variant.trace,
      events.reduce<Trace>(updateTrace, []),
    );
    assert.deepEqual(
      position.variant.trace.map((entry) => entry.type),
      ['reasoning', 'tool', 'reasoning'],
    );
    assert.match(
      position.variant.source,
      /^Partial answer\.<system_error>|^Partial answer\.\n/u,
    );
    assert.match(position.variant.source, /<system_error>/u);
    const tool = position.variant.trace[1];
    assert.equal(tool?.type, 'tool');
    assert.equal(tool.result, null);
    assert.equal(tool.completedAt, null);
  });
}

test('a variant without provider reasoning retains none', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  fixture.faux.setResponses([fauxAssistantMessage('Plain.')]);
  const address = await listen(fixture.runtime);
  const sessionId = await createSession(address);
  await readEvents(
    await streamAttempt(address, sessionId, { kind: 'reply', text: 'Plain?' }),
  );

  assert.deepEqual(
    finalAssistant(await projection(address, sessionId)).variant.trace,
    [],
  );
});

test('a provider failure completes the admitted response with its partial text', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  fixture.faux.setResponses([
    fauxAssistantMessage('Partial answer.', {
      stopReason: 'error',
      errorMessage: 'provider unavailable',
    }),
  ]);
  const address = await listen(fixture.runtime);
  const sessionId = await createSession(address);
  const events = await readEvents(
    await streamAttempt(address, sessionId, {
      kind: 'reply',
      text: 'Please answer.',
    }),
  );
  assert.deepEqual(
    events.slice(0, 2).map((event) => event.type),
    ['queued', 'admitted'],
  );
  assert.equal(events.at(-1)?.type, 'completed');
  assert.match(
    finalAssistant(await projection(address, sessionId)).variant.source,
    /Partial answer\.[\s\S]*<system_error>provider unavailable<\/system_error>/u,
  );
});

for (const empty of [false, true])
  test(`disconnect after admission preserves ${empty ? 'an empty provider outcome' : 'the answer'}`, async (context) => {
    const fixture = await createTestFixture();
    context.after(() => fixture.runtime.close());
    const started = Promise.withResolvers<undefined>();
    const finish = Promise.withResolvers<undefined>();
    const disconnected = Promise.withResolvers<undefined>();
    fixture.runtime.app.addHook('onRequest', async (request, reply) => {
      if (request.url.endsWith('/attempts'))
        reply.raw.once('close', () => disconnected.resolve(undefined));
    });
    fixture.faux.setResponses([
      async (_providerContext, options) => {
        started.resolve(undefined);
        await finish.promise;
        assert.equal(options?.signal?.aborted, false);
        return fauxAssistantMessage(
          empty ? [fauxThinking('Only reasoning.')] : 'Finished while away.',
        );
      },
    ]);
    const address = await listen(fixture.runtime);
    const sessionId = await createSession(address);
    const response = await streamAttempt(address, sessionId, {
      kind: 'reply',
      text: 'Continue while I leave.',
    });
    await started.promise;
    const attemptId = response.headers.get('x-attempt-id');
    assert.ok(attemptId);
    await response.body?.cancel();
    await disconnected.promise;
    assert.equal(
      (await projection(address, sessionId)).activeAttemptId,
      attemptId,
    );
    finish.resolve(undefined);
    await assertWhen(async () => {
      const session = await projection(address, sessionId);
      assert.equal(session.activeAttemptId, null);
      assert.equal(
        finalAssistant(session).variant.source,
        empty
          ? '<system_error>Provider returned no text</system_error>'
          : 'Finished while away.',
      );
    });
  });

test('disconnect while queued preserves the send and exposes it until completion', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const started = Promise.withResolvers<undefined>();
  const finish = Promise.withResolvers<undefined>();
  const disconnected = Promise.withResolvers<undefined>();
  let requests = 0;
  fixture.runtime.app.addHook('onRequest', async (request, reply) => {
    if (request.url.endsWith('/attempts') && ++requests === 2)
      reply.raw.once('close', () => disconnected.resolve(undefined));
  });
  fixture.faux.setResponses([
    async () => {
      started.resolve(undefined);
      await finish.promise;
      return fauxAssistantMessage('First response.');
    },
    fauxAssistantMessage('Queued response completed.'),
  ]);
  const address = await listen(fixture.runtime);
  const sessionId = await createSession(address);
  const first = await streamAttempt(address, sessionId, {
    kind: 'reply',
    text: 'First.',
  });
  await started.promise;
  const queuedSessionId = await createSession(address);
  const queued = await streamAttempt(address, queuedSessionId, {
    kind: 'reply',
    text: 'Queued before leaving.',
  });
  await queued.body?.cancel();
  await disconnected.promise;
  assert.equal(
    (await projection(address, queuedSessionId)).activeAttemptId,
    queued.headers.get('x-attempt-id'),
  );
  finish.resolve(undefined);
  await readEvents(first);
  await assertWhen(async () => {
    const current = await projection(address, queuedSessionId);
    assert.equal(current.activeAttemptId, null);
    assert.equal(
      finalAssistant(current).variant.source,
      'Queued response completed.',
    );
    assert.ok(
      current.positions.some(
        (position) =>
          position.role === 'user' &&
          position.source === 'Queued before leaving.',
      ),
    );
  });
});

test('stopping after admission completes the canonical response', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const started = Promise.withResolvers<undefined>();
  fixture.faux.setResponses([
    (_providerContext, options) => {
      started.resolve(undefined);
      return new Promise((resolve) =>
        options?.signal?.addEventListener(
          'abort',
          () =>
            resolve(
              fauxAssistantMessage('', {
                stopReason: 'aborted',
                errorMessage: 'aborted',
              }),
            ),
          { once: true },
        ),
      );
    },
  ]);
  const address = await listen(fixture.runtime);
  const sessionId = await createSession(address);
  const response = await streamAttempt(address, sessionId, {
    kind: 'reply',
    text: 'Wait.',
  });
  const attemptId = response.headers.get('x-attempt-id');
  assert.ok(attemptId);
  await started.promise;
  const otherSessionId = await createSession(address);
  const wrongSession = await fetch(
    `${address}/api/sessions/${otherSessionId}/attempts/${attemptId}`,
    { method: 'DELETE' },
  );
  assert.equal(wrongSession.status, 404);
  assert.equal(fixture.runtime.attempts.activeAttemptId(sessionId), attemptId);
  assert.equal(
    (
      await fetch(
        `${address}/api/sessions/${sessionId}/attempts/${attemptId}`,
        {
          method: 'DELETE',
        },
      )
    ).status,
    202,
  );
  const events = await readEvents(response);
  assert.equal(events.at(-1)?.type, 'completed');
  assert.match(
    finalAssistant(await projection(address, sessionId)).variant.source,
    /<system_error>Generation stopped by operator\.<\/system_error>/u,
  );
});

async function projection(address: string, sessionId: string) {
  const response = await fetch(`${address}/api/sessions/${sessionId}`);
  if (!response.ok) throw new Error(await response.text());
  return flatten(sessionProjectionSchema.parse(await response.json()));
}

function flatten(
  value: SessionProjection,
): SessionChange & Pick<SessionProjection, 'activeAttemptId'> {
  const { page, ...state } = value;
  return { ...state, positions: page.positions };
}

async function mutate(
  address: string,
  path: string,
  method: string,
  body: unknown,
): Promise<SessionChange> {
  const response = await fetch(`${address}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return sessionChangeSchema.parse(await response.json());
}

function finalAssistant(value: {
  positions: SessionChange['positions'];
}): Extract<SessionChange['positions'][number], { role: 'assistant' }> {
  const position = value.positions.at(-1);
  if (position?.role !== 'assistant') throw new Error('Missing assistant');
  return position;
}

async function assertWhen(check: () => Promise<void>): Promise<void> {
  for (let tries = 0; ; tries++) {
    try {
      await check();
      return;
    } catch (error) {
      if (tries === 100) throw error;
      await setTimeout(10);
    }
  }
}
