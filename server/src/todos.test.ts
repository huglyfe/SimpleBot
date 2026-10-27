import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { MAX_TODOS, sessionContextSchema } from '@simplebot/shared';
import {
  createTestFixture,
  disposeTestFixture,
  listen,
  createSession,
  streamAttempt,
  readEvents,
  seedExchange,
  reopenTestFixture,
} from './test-helper.js';

const now = '2026-10-21T12:00:00.000Z';

test('to-do tools keep accepted reads frozen and apply only the selected swipe, including an add followed by update', async (t) => {
  const fixture = await createTestFixture({ clock: () => new Date(now) });
  t.after(() => disposeTestFixture(fixture));
  const presetPath = join(fixture.root, 'presets/default.json');
  const preset = JSON.parse(await readFile(presetPath, 'utf8')) as {
    prompts: { postHistory: string };
  };
  preset.prompts.postHistory = '{{todos}}';
  await writeFile(presetPath, JSON.stringify(preset));
  const address = await listen(fixture.runtime);
  const session = await createSession(address);
  const run = async (command: unknown) => {
    const event = (
      await readEvents(await streamAttempt(address, session, command))
    ).at(-1);
    if (event?.type !== 'completed') throw new Error('Missing completed event');
    return event;
  };
  fixture.faux.setResponses([
    fauxAssistantMessage(
      [fauxToolCall('system__todo_add', { title: 'Discarded goal' })],
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage('First proposal.'),
  ]);
  const first = await run({ kind: 'reply', text: 'Choose a goal.' });
  assert.deepEqual(fixture.runtime.storage.listTodos(session), []);
  let id = '';
  fixture.faux.setResponses([
    (input) => {
      assert.match(JSON.stringify(input.messages), /No open to-dos\./u);
      return fauxAssistantMessage(
        [
          fauxToolCall('system__todo_add', {
            title: 'Submit application',
            dueDate: '2026-10-22',
            note: 'Reward: dinner',
          }),
          fauxToolCall('system__todo_list', {}),
        ],
        { stopReason: 'toolUse' },
      );
    },
    (input) => {
      const receipt = input.messages.find(
        (message) =>
          message.role === 'toolResult' &&
          message.toolName === 'system__todo_add',
      );
      assert.ok(receipt);
      id =
        /[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/u.exec(
          JSON.stringify(receipt),
        )?.[0] ?? '';
      assert.ok(id);
      const listed = input.messages.at(-1);
      assert.equal(listed?.role, 'toolResult');
      assert.deepEqual(listed.content, [{ type: 'text', text: '[]' }]);
      return fauxAssistantMessage(
        [
          fauxToolCall('system__todo_update', {
            id,
            note: 'Reward: dinner. Price: chores.',
          }),
        ],
        { stopReason: 'toolUse' },
      );
    },
    fauxAssistantMessage('Second proposal.'),
  ]);
  await run({ kind: 'swipe', positionId: first.positionId });
  assert.deepEqual(fixture.runtime.storage.listTodos(session), []);
  const accepted = await fixture.runtime.app.inject({
    method: 'POST',
    url: `/api/sessions/${session}/positions/${first.positionId}/accept`,
  });
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.deepEqual(fixture.runtime.storage.listTodos(session), [
    {
      id,
      title: 'Submit application',
      dueDate: '2026-10-22',
      note: 'Reward: dinner. Price: chores.',
    },
  ]);
  const again = await fixture.runtime.app.inject({
    method: 'POST',
    url: `/api/sessions/${session}/positions/${first.positionId}/accept`,
  });
  assert.equal(again.statusCode, 409);
  fixture.faux.setResponses([
    (input) => {
      assert.match(
        JSON.stringify(input.messages),
        /2026-10-22 \(due tomorrow\)/u,
      );
      assert.doesNotMatch(JSON.stringify(input.messages), /Discarded goal/u);
      return fauxAssistantMessage(
        [fauxToolCall('system__todo_update', { id, status: 'missed' })],
        { stopReason: 'toolUse' },
      );
    },
    fauxAssistantMessage('Judgment recorded in conversation.'),
  ]);
  const closing = await run({ kind: 'reply', text: 'Close it.' });
  assert.equal(fixture.runtime.storage.listTodos(session).length, 1);
  await fixture.runtime.app.inject({
    method: 'POST',
    url: `/api/sessions/${session}/positions/${closing.positionId}/accept`,
  });
  assert.deepEqual(fixture.runtime.storage.listTodos(session), []);
});

test('operator to-dos validate, patch by ID, enforce the cap, and remain session-local', async (t) => {
  const fixture = await createTestFixture();
  t.after(() => disposeTestFixture(fixture));
  const address = await listen(fixture.runtime);
  const session = await createSession(address);
  const other = await createSession(address);
  const url = `/api/sessions/${session}/todos`;
  for (const payload of [
    { title: ' ' },
    { title: 'Invalid date', dueDate: '2026-02-30' },
    { title: 'Long', note: 'x'.repeat(2001) },
  ]) {
    assert.equal(
      (await fixture.runtime.app.inject({ method: 'POST', url, payload }))
        .statusCode,
      400,
    );
  }
  assert.equal(
    (
      await fixture.runtime.app.inject({
        method: 'POST',
        url,
        payload: {
          title: '  Goal  ',
          dueDate: '2026-10-22',
          note: 'Keep this',
        },
      })
    ).statusCode,
    204,
  );
  const projection = sessionContextSchema.parse(
    (
      await fixture.runtime.app.inject({
        method: 'GET',
        url: `/api/sessions/${session}/context`,
      })
    ).json(),
  );
  const todo = projection.todos[0];
  assert.ok(todo);
  assert.equal(todo.title, 'Goal');
  assert.equal(
    (
      await fixture.runtime.app.inject({
        method: 'PATCH',
        url: `${url}/${todo.id}`,
        payload: { dueDate: null },
      })
    ).statusCode,
    204,
  );
  assert.deepEqual(fixture.runtime.storage.listTodos(session), [
    { ...todo, dueDate: null },
  ]);
  assert.equal(
    (
      await fixture.runtime.app.inject({
        method: 'PATCH',
        url: `${url}/${todo.id}`,
        payload: {},
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await fixture.runtime.app.inject({
        method: 'PATCH',
        url: `/api/sessions/${other}/todos/${todo.id}`,
        payload: { status: 'done' },
      })
    ).statusCode,
    404,
  );
  for (let i = 1; i < MAX_TODOS; i++)
    fixture.runtime.storage.addTodo(
      session,
      { id: randomUUID(), title: 'Another', dueDate: null, note: '' },
      now,
    );
  assert.equal(
    (
      await fixture.runtime.app.inject({
        method: 'POST',
        url,
        payload: { title: 'Over cap' },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await fixture.runtime.app.inject({
        method: 'PATCH',
        url: `${url}/${todo.id}`,
        payload: { title: 'At cap' },
      })
    ).statusCode,
    204,
  );
  for (const status of ['done', 'missed', 'dropped']) {
    const item = fixture.runtime.storage.listTodos(session)[0];
    assert.ok(item);
    assert.equal(
      (
        await fixture.runtime.app.inject({
          method: 'PATCH',
          url: `${url}/${item.id}`,
          payload: { status },
        })
      ).statusCode,
      204,
    );
  }
  await fixture.runtime.storage.deleteSession(session);
  assert.deepEqual(fixture.runtime.storage.listTodos(session), []);
});

test('to-do effects commit atomically, continue after failure, and never replay at restart', async (t) => {
  const fixture = await createTestFixture();
  const address = await listen(fixture.runtime);
  const session = await createSession(address);
  const id = randomUUID();
  const target = seedExchange(fixture, {
    sessionId: session,
    user: 'Set goals',
    assistant: 'Proposal',
    now,
    effects: [
      {
        type: 'todo_add',
        arguments: { id, title: 'First', dueDate: null, note: '' },
      },
      {
        type: 'todo_update',
        arguments: { id: randomUUID(), title: 'Missing' },
      },
      { type: 'todo_update', arguments: { id, title: 'Last' } },
    ],
  });
  fixture.runtime.storage.connection.exec(
    `CREATE TRIGGER refuse_todo_result BEFORE UPDATE OF state ON effects WHEN NEW.type = 'todo_add' AND NEW.state = 'applied' BEGIN SELECT RAISE(ABORT, 'result refused'); END;`,
  );
  fixture.runtime.storage.acceptPosition(session, target.positionId, now);
  await fixture.runtime.storage.drainEffects(session, now, 'UTC');
  assert.deepEqual(fixture.runtime.storage.listTodos(session), []);
  fixture.runtime.storage.connection.exec('DROP TRIGGER refuse_todo_result');
  const next = seedExchange(fixture, {
    sessionId: session,
    user: 'Again',
    assistant: 'Proposal',
    now,
    effects: [
      {
        type: 'todo_add',
        arguments: { id, title: 'First', dueDate: null, note: '' },
      },
      {
        type: 'todo_update',
        arguments: { id: randomUUID(), title: 'Missing' },
      },
      { type: 'todo_update', arguments: { id, title: 'Last' } },
    ],
  });
  fixture.runtime.storage.acceptPosition(session, next.positionId, now);
  await fixture.runtime.storage.drainEffects(session, now, 'UTC');
  assert.equal(fixture.runtime.storage.listTodos(session)[0]?.title, 'Last');
  fixture.runtime.storage.updateTodo(
    session,
    { id, title: 'Operator edit' },
    now,
  );
  const interrupted = seedExchange(fixture, {
    sessionId: session,
    user: 'Close',
    assistant: 'Proposal',
    now,
    effects: [{ type: 'todo_update', arguments: { id, status: 'done' } }],
  });
  fixture.runtime.storage.acceptPosition(session, interrupted.positionId, now);
  await fixture.runtime.close();
  const reopened = await reopenTestFixture(fixture);
  t.after(() =>
    disposeTestFixture({ root: fixture.root, runtime: reopened.runtime }),
  );
  assert.equal(
    reopened.runtime.storage.listTodos(session)[0]?.title,
    'Operator edit',
  );
  const effects = reopened.runtime.storage
    .projection(session)
    .page.positions.filter((p) => p.role === 'assistant')
    .flatMap((p) => p.variant.effects);
  assert.deepEqual(
    effects.slice(3).map((e) => e.state),
    ['applied', 'failed', 'applied', 'unresolved'],
  );
  await reopened.runtime.storage.drainEffects(session, now, 'UTC');
  assert.equal(reopened.runtime.storage.listTodos(session).length, 1);
});
