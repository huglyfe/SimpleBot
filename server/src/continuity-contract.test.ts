import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import {
  promptTokenCount,
  sessionChangeSchema,
  sessionProjectionSchema,
  type SessionChange,
  type SessionContext,
  type SessionProjection,
} from '@simplebot/shared';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  disposeTestFixture,
  createSession,
  createTestFixture,
  listen,
  readEvents,
  reopenTestFixture,
  seedExchange,
  streamAttempt,
} from './test-helper.js';

test('Context owns leaves and compact-now activates one immediately', async (context) => {
  const fixture = await createTestFixture();
  await fixture.runtime.close();
  const presetPath = join(fixture.root, 'presets', 'default.json');
  const preset = JSON.parse(await readFile(presetPath, 'utf8')) as {
    context?: Record<string, unknown>;
  };
  preset.context = {
    thresholdTokens: 1_000_000,
    liveTailExchanges: 1,
    activeLeafCap: 5,
    summaryLengthChars: 6_000,
  };
  await writeFile(presetPath, JSON.stringify(preset));
  const reopened = await reopenTestFixture({
    root: fixture.root,
    faux: fixture.faux,
  });
  context.after(() => reopened.runtime.close());
  fixture.faux.setResponses([
    fauxAssistantMessage('First answer.'),
    fauxAssistantMessage('Second answer.'),
    fauxAssistantMessage('First exchange summarized.'),
    (providerContext) => {
      const messages = JSON.stringify(providerContext.messages);
      assert.match(messages, /First exchange summarized\./u);
      assert.doesNotMatch(messages, /First answer\./u);
      return fauxAssistantMessage('Second answer, retried.');
    },
  ]);
  const address = await listen(reopened.runtime);
  const sessionId = await createSession(address);
  await readEvents(
    await streamAttempt(address, sessionId, { kind: 'reply', text: 'First.' }),
  );
  const second = (
    await readEvents(
      await streamAttempt(address, sessionId, {
        kind: 'reply',
        text: 'Second.',
      }),
    )
  ).at(-1);
  if (second?.type !== 'completed') throw new Error('Missing response');

  const compacted = await fetch(
    `${address}/api/sessions/${sessionId}/compact`,
    { method: 'POST' },
  );
  assert.equal(compacted.status, 204);
  const active = (await (
    await fetch(`${address}/api/sessions/${sessionId}/context`)
  ).json()) as SessionContext;
  assert.equal(active.leaves[0]?.state, 'committed');
  assert.equal('liveTailExchanges' in active, false);
  assert.equal('thresholdTokens' in active, false);
  assert.equal(active.exactFromExchange, 2);
  assert.equal(active.currentExchange, 2);

  const swipe = await readEvents(
    await streamAttempt(address, sessionId, {
      kind: 'swipe',
      positionId: second.positionId,
    }),
  );
  assert.equal(swipe.at(-1)?.type, 'completed');
  assert.equal(
    finalAssistant(await projection(address, sessionId)).variant.source,
    'Second answer, retried.',
  );
});

test('automatic compaction uses prompt usage and waits for acceptance', async (context) => {
  const thresholdTokens = 2_000;
  const fixture = await createTestFixture();
  await fixture.runtime.close();
  const presetPath = join(fixture.root, 'presets', 'default.json');
  const preset = JSON.parse(await readFile(presetPath, 'utf8')) as {
    context?: Record<string, unknown>;
  };
  preset.context = {
    thresholdTokens,
    liveTailExchanges: 1,
    activeLeafCap: 5,
    summaryLengthChars: 6_000,
  };
  await writeFile(presetPath, JSON.stringify(preset));
  const reopened = await reopenTestFixture({
    root: fixture.root,
    faux: fixture.faux,
  });
  context.after(() => reopened.runtime.close());
  fixture.faux.setResponses([
    fauxAssistantMessage('First answer.'),
    fauxAssistantMessage('x'.repeat(10_000)),
    fauxAssistantMessage('Third answer.'),
    fauxAssistantMessage('Earlier exchanges summarized.'),
  ]);
  const address = await listen(reopened.runtime);
  const sessionId = await createSession(address);
  await readEvents(
    await streamAttempt(address, sessionId, { kind: 'reply', text: 'First.' }),
  );
  assert.deepEqual(
    finalAssistant(await projection(address, sessionId)).variant.effects,
    [],
  );
  await readEvents(
    await streamAttempt(address, sessionId, { kind: 'reply', text: 'Second.' }),
  );
  const beforeCompaction = (await (
    await fetch(`${address}/api/sessions/${sessionId}/context`)
  ).json()) as SessionContext;
  assert.equal(
    beforeCompaction.lastRequestUsage === null
      ? null
      : promptTokenCount(beforeCompaction.lastRequestUsage) < thresholdTokens,
    true,
  );
  assert.ok(
    (beforeCompaction.lastRequestUsage?.totalTokens ?? 0) > thresholdTokens,
  );
  assert.deepEqual(
    finalAssistant(await projection(address, sessionId)).variant.effects,
    [],
  );
  assert.deepEqual(beforeCompaction.leaves, []);

  const third = await readEvents(
    await streamAttempt(address, sessionId, { kind: 'reply', text: 'Third.' }),
  );
  assert.equal(third.at(-1)?.type, 'completed');
  const candidate = finalAssistant(await projection(address, sessionId));
  assert.deepEqual(candidate.variant.effects, []);
  assert.equal(fixture.faux.getPendingResponseCount(), 1);
  const pending = (await (
    await fetch(`${address}/api/sessions/${sessionId}/context`)
  ).json()) as SessionContext;
  assert.deepEqual(pending.leaves, []);
  preset.context.thresholdTokens = 1;
  await writeFile(presetPath, JSON.stringify(preset));
  await mutate(
    address,
    `/api/sessions/${sessionId}/positions/${candidate.id}/accept`,
    'POST',
    {},
  );
  assert.deepEqual(
    finalAssistant(await projection(address, sessionId)).variant.effects,
    [],
  );
  const current = (await (
    await fetch(`${address}/api/sessions/${sessionId}/context`)
  ).json()) as SessionContext;
  assert.equal(current.leaves[0]?.summary, 'Earlier exchanges summarized.');
});

for (const selectSwipe of [false, true])
  test(`acceptance after restart uses ${selectSwipe ? 'the selected swipe usage' : 'saved usage and accepted effects'} for compaction`, async (context) => {
    const fixture = await createTestFixture();
    context.after(() => fixture.runtime.close());
    const presetPath = join(fixture.root, 'presets', 'default.json');
    const preset = JSON.parse(await readFile(presetPath, 'utf8')) as {
      context: Record<string, unknown>;
    };
    preset.context = {
      ...preset.context,
      thresholdTokens: 10_000,
      liveTailExchanges: 1,
    };
    await writeFile(presetPath, JSON.stringify(preset));
    const address = await listen(fixture.runtime);
    const sessionId = await createSession(address);
    const now = new Date().toISOString();
    seedExchange(fixture, {
      sessionId,
      user: 'Older',
      assistant: 'Older answer',
      now,
      lock: true,
    });
    const usage = {
      ...fauxAssistantMessage('Seed').usage,
      input: 20_000,
      totalTokens: 20_000,
    };
    const target = seedExchange(fixture, {
      sessionId,
      user: 'Current',
      assistant: 'Original answer',
      now,
      usages: [usage],
      effects: [
        {
          type: 'variable_set',
          arguments: { name: 'mood', value: 'accepted' },
        },
      ],
    });
    if (selectSwipe) {
      fixture.faux.setResponses([fauxAssistantMessage('Replacement answer')]);
      await readEvents(
        await streamAttempt(address, sessionId, {
          kind: 'swipe',
          positionId: target.positionId,
        }),
      );
    }
    assert.deepEqual(
      fixture.runtime.storage.contextEvidence(sessionId, 5, 'UTC').leaves,
      [],
    );
    await fixture.runtime.close();
    const reopened = await reopenTestFixture({
      root: fixture.root,
      faux: fixture.faux,
    });
    context.after(() => reopened.runtime.close());
    const nextAddress = await listen(reopened.runtime);
    assert.deepEqual(
      reopened.runtime.storage.contextEvidence(sessionId, 5, 'UTC').leaves,
      [],
    );
    let summaries = 0;
    fixture.faux.setResponses([
      ...(selectSwipe
        ? []
        : [
            () => {
              summaries++;
              assert.equal(
                reopened.runtime.storage.sessionVariables(sessionId).mood,
                'accepted',
              );
              return fauxAssistantMessage('Earlier continuity.');
            },
          ]),
      (providerContext) => {
        assert.equal(
          JSON.stringify(providerContext.messages).includes(
            'Earlier continuity.',
          ),
          !selectSwipe,
        );
        return fauxAssistantMessage('Next reply.');
      },
    ]);
    await readEvents(
      await streamAttempt(nextAddress, sessionId, {
        kind: 'reply',
        text: 'Accept and continue',
      }),
    );
    assert.equal(
      finalAssistant(await projection(nextAddress, sessionId)).variant.source,
      'Next reply.',
    );
    assert.equal(summaries, selectSwipe ? 0 : 1);
    assert.equal(
      reopened.runtime.storage.contextEvidence(sessionId, 5, 'UTC').leaves
        .length,
      selectSwipe ? 0 : 1,
    );
  });

test('Compact now covers newly eligible history after reducing the tail without another reply', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const app = fixture.runtime.app;
  const created = await app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: { botSlug: 'echo' },
  });
  assert.equal(created.statusCode, 201);
  const { id: sessionId } = created.json<{ id: string }>();
  for (let turn = 0; turn < 12; turn += 1) {
    seedExchange(fixture, {
      sessionId,
      user: `Question ${String(turn)}`,
      assistant: `Answer ${String(turn)}`,
      now: '2026-01-01T00:00:00.000Z',
      lock: turn < 11,
    });
  }
  const path = join(fixture.root, 'presets', 'default.json');
  const preset = JSON.parse(await readFile(path, 'utf8')) as {
    context: { liveTailExchanges: number };
  };
  preset.context = { liveTailExchanges: 10 };
  await writeFile(path, JSON.stringify(preset));
  fixture.faux.setResponses([
    fauxAssistantMessage('First range.'),
    fauxAssistantMessage('Additional range.'),
  ]);
  const compact = () =>
    app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/compact` });
  const evidence = async () =>
    (
      await app.inject({ url: `/api/sessions/${sessionId}/context` })
    ).json<SessionContext>();
  assert.equal((await compact()).statusCode, 204);
  assert.equal((await evidence()).canCompact, false);
  preset.context.liveTailExchanges = 1;
  await writeFile(path, JSON.stringify(preset));
  assert.equal((await evidence()).canCompact, true);
  assert.equal((await compact()).statusCode, 204);
  const covered = await evidence();
  assert.equal(covered.leaves.length, 2);
  assert.equal(covered.exactFromExchange, 12);
  assert.equal(covered.currentExchange, 12);
  assert.equal(covered.canCompact, false);
  for (let repeat = 0; repeat < 3; repeat += 1) {
    assert.equal((await compact()).statusCode, 204);
    assert.deepEqual(await evidence(), covered);
  }
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
