import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  fauxAssistantMessage,
  getCurrentSystemPrompt,
  fauxToolCall,
  type Usage,
} from '@earendil-works/pi-ai';
import Database from 'better-sqlite3';

import { assembleAttempt } from './assemble.js';
import { AuthoredFiles } from './authored.js';
import { cardSchema, presetSchema } from './authored-schemas.js';
import { searchHistory } from './storage.js';
import { compactSession, SUMMARY_CLIPPED } from './continuity.js';
import { SCHEMA_VERSION } from './database.js';
import { openStorage, type Storage } from './storage.js';
import {
  disposeTestFixture,
  createTestFixture,
  seedExchange,
} from './test-helper.js';

const schema = fileURLToPath(new URL('../schema.sql', import.meta.url));
const now = '2026-08-23T12:00:00.000Z';

async function fixture(context: TestContext): Promise<{
  root: string;
  storage: Storage;
}> {
  const root = await mkdtemp(join(tmpdir(), 'simplebot-kernel-'));
  const storage = await openStorage(
    join(root, 'app.db'),
    schema,
    join(root, 'attachments'),
  );
  context.after(async () => {
    if (storage.connection.open) storage.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, storage };
}

function createSession(storage: Storage): string {
  const id = randomUUID();
  storage.createSession({
    id,
    botSlug: 'echo',
    presetSlug: 'default',
    now,
  });
  return id;
}

function admitReply(storage: Storage, sessionId: string, text: string) {
  return storage.admitAttempt({
    sessionId,
    target: { kind: 'reply', source: text },
    variantId: randomUUID(),
    now,
  });
}

function finish(
  storage: Storage,
  sessionId: string,
  admitted: { positionId: string; variantId: string },
  source: string,
  usages: readonly (Usage | null)[] = [],
): void {
  storage.finalizeVariant({
    sessionId,
    ...admitted,
    source,
    trace: [],
    usages,
    provider: 'faux',
    model: 'faux-model',
    completedAt: now,
  });
}

/** One provider call that cost `total`; the token split does not matter here. */
function spend(total: number): Usage {
  return {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: total, output: 0, cacheRead: 0, cacheWrite: 0, total },
  };
}

test('last swipe cost sums its provider calls and excludes discarded swipes', async (context) => {
  const { storage } = await fixture(context);
  const sessionId = createSession(storage);
  const first = admitReply(storage, sessionId, 'Hello');
  // Two calls in one turn: the tool round trip and the reply that followed.
  finish(storage, sessionId, first, 'Hi', [spend(0.01), spend(0.002)]);
  const swipe = storage.admitAttempt({
    sessionId,
    target: { kind: 'swipe', positionId: first.positionId },
    variantId: randomUUID(),
    now,
  });
  // The latest selected swipe owns the displayed cost.
  finish(storage, sessionId, swipe, 'Hey', [spend(0.5), spend(0.25)]);

  assert.equal(
    storage.contextEvidence(sessionId, 100, 'UTC').lastSwipeCost,
    0.75,
  );
});

test('message cost distinguishes missing, partial, and reported zero usage', async (context) => {
  const { storage } = await fixture(context);
  for (const [usages, expected] of [
    [[], null],
    [[null], null],
    [[spend(0.5), null], null],
    [[null, spend(0.5)], null],
    [[spend(0)], 0],
  ] satisfies [readonly (Usage | null)[], number | null][]) {
    const sessionId = createSession(storage);
    assert.equal(
      storage.contextEvidence(sessionId, 100, 'UTC').lastSwipeCost,
      null,
    );
    const admitted = admitReply(storage, sessionId, 'Hello');
    finish(storage, sessionId, admitted, 'Hi', usages);
    assert.equal(
      storage.contextEvidence(sessionId, 100, 'UTC').lastSwipeCost,
      expected,
    );
  }
});

test('Context, compaction, and regeneration omit long transcript inspection data', async (context) => {
  const { storage } = await fixture(context);
  const sessionId = createSession(storage);
  const canCompact = (tail: number) =>
    storage.contextEvidence(sessionId, 5, 'UTC', new Date(now), tail)
      .canCompact;
  for (let turn = 0; turn < 200; turn += 1) {
    const admitted = admitReply(storage, sessionId, `Turn ${String(turn)}`);
    finish(storage, sessionId, admitted, `Answer ${String(turn)}`, [
      spend(0.01),
    ]);
    storage.acceptPosition(sessionId, admitted.positionId, now);
  }
  storage.connection
    .prepare('UPDATE message_variants SET trace_json = ?')
    .run(
      JSON.stringify([
        { type: 'reasoning', text: 'Inspection evidence. '.repeat(800) },
      ]),
    );
  const statements: string[] = [];
  const prepare = storage.connection.prepare.bind(storage.connection);
  const spy = context.mock.method(
    storage.connection,
    'prepare',
    (sql: string) => {
      statements.push(sql);
      return prepare(sql);
    },
  );
  assert.equal(canCompact(10), true);
  assert.equal(canCompact(200), false);
  const evidence = storage.contextEvidence(
    sessionId,
    5,
    'UTC',
    new Date(now),
    10,
  );
  assert.equal(evidence.currentExchange, 200);
  assert.equal(evidence.lastSwipeCost, 0.01);
  assert.equal(evidence.canCompact, true);
  assert.equal(
    statements.some((sql) => /trace_json|FROM attachments/u.test(sql)),
    false,
  );
  statements.length = 0;

  const leaf = storage.createPendingLeaf({
    sessionId,
    liveTailExchanges: 10,
    now,
  });
  assert.ok(leaf);
  assert.equal(leaf.startOrdinal, 0);
  assert.equal(leaf.endOrdinal, 379);
  assert.ok(leaf.source.includes('Answer 189'));
  assert.ok(!leaf.source.includes('Turn 190'));
  assert.equal(canCompact(10), false);
  storage.commitLeaf(leaf.id, 'Earlier conversation', 'model', now);
  assert.equal(
    storage.leafRegenerationInput(sessionId, leaf.id).source,
    leaf.source,
  );
  assert.equal(
    statements.some((sql) =>
      /trace_json|FROM effects|variant_count/u.test(sql),
    ),
    false,
  );
  spy.mock.restore();
  assert.equal(canCompact(10), false);
  // A pre-fix leaf could name the latest response as its trigger. Its range,
  // not that legacy provenance, must decide what remains compactable.
  storage.connection
    .prepare(
      `UPDATE leaves SET trigger_position_id = (
    SELECT id FROM message_positions WHERE session_id = ? ORDER BY ordinal DESC LIMIT 1
  ) WHERE id = ?`,
    )
    .run(sessionId, leaf.id);
  assert.equal(canCompact(1), true);
  const reduced = storage.createPendingLeaf({
    sessionId,
    liveTailExchanges: 1,
    now,
  });
  assert.ok(reduced);
  assert.equal(reduced.startOrdinal, 380);
  assert.equal(reduced.endOrdinal, 397);
  assert.ok(reduced.source.includes('Answer 198'));
  assert.ok(!reduced.source.includes('Turn 199'));
  storage.commitLeaf(reduced.id, 'Newly eligible history', 'model', now);
  for (let repeat = 0; repeat < 3; repeat += 1) {
    assert.equal(canCompact(1), false);
    assert.equal(
      storage.createPendingLeaf({ sessionId, liveTailExchanges: 1, now }),
      null,
    );
  }
  const next = admitReply(storage, sessionId, 'Next turn');
  finish(storage, sessionId, next, 'Next answer');
  assert.equal(canCompact(1), true);
});

test('schema.sql stamps the version the code reads', () => {
  const stamped =
    /PRAGMA user_version = (?<version>\d+);/u.exec(readFileSync(schema, 'utf8'))
      ?.groups?.version ?? '';
  assert.equal(Number(stamped), SCHEMA_VERSION);
});

test('schema 14 refuses without converting session state', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'simplebot-old-schema-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const databasePath = join(root, 'app.db');
  const old = new Database(databasePath);
  old.exec(
    "CREATE TABLE legacy (value TEXT); INSERT INTO legacy VALUES ('keep'); PRAGMA user_version = 14;",
  );
  old.close();

  await assert.rejects(
    openStorage(databasePath, schema, join(root, 'attachments')),
    /startup does not migrate data/u,
  );
  const unchanged = new Database(databasePath, { readonly: true });
  assert.equal(
    unchanged
      .prepare("SELECT name FROM sqlite_master WHERE name = 'legacy'")
      .get() !== undefined,
    true,
  );
  assert.equal(unchanged.pragma('user_version', { simple: true }), 14);
  assert.deepEqual(unchanged.prepare('SELECT value FROM legacy').all(), [
    { value: 'keep' },
  ]);
  unchanged.close();
});

test('a root from a newer build refuses rather than downgrading', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'simplebot-new-schema-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const databasePath = join(root, 'app.db');
  const newer = new Database(databasePath);
  newer.exec(readFileSync(schema, 'utf8'));
  newer.pragma(`user_version = ${String(SCHEMA_VERSION + 1)}`);
  newer.close();

  await assert.rejects(
    openStorage(databasePath, schema, join(root, 'attachments')),
    /startup does not migrate data/u,
  );
});

test('a root at the current schema reopens with its conversations intact', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'simplebot-reopen-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const databasePath = join(root, 'app.db');
  const attachments = join(root, 'attachments');

  const first = await openStorage(databasePath, schema, attachments);
  first.createSession({
    id: 'session-reopen',
    botSlug: 'help',
    presetSlug: 'default',
    now: new Date().toISOString(),
  });
  first.close();

  const second = await openStorage(databasePath, schema, attachments);
  context.after(() => second.close());
  assert.notEqual(second.sessionIdentity('session-reopen'), null);
});

test('admission is canonical and restart completes an interrupted reply', async (context) => {
  const { root, storage } = await fixture(context);
  const sessionId = createSession(storage);
  const admitted = admitReply(storage, sessionId, 'Hello');
  const before = storage.projection(sessionId).page.positions;
  assert.equal(before[0]?.role, 'user');
  const admittedAssistant = before[1];
  if (admittedAssistant?.role !== 'assistant')
    throw new Error('Missing response');
  assert.equal(admittedAssistant.variant.source, '');
  assert.throws(
    () => storage.acceptPosition(sessionId, admitted.positionId, now),
    /cannot be accepted/u,
  );
  assert.throws(
    () =>
      storage.finalizeVariant({
        sessionId,
        ...admitted,
        source: '',
        trace: [],
        usages: [],
        provider: 'faux',
        model: 'faux-model',
        completedAt: now,
      }),
    /cannot be empty/u,
  );

  storage.close();
  const reopened = await openStorage(
    join(root, 'app.db'),
    schema,
    join(root, 'attachments'),
  );
  const assistant = reopened.projection(sessionId).page.positions[1];
  assert.equal(assistant?.role, 'assistant');
  assert.match(assistant.variant.source, /^<system_error>.+<\/system_error>$/u);
  assert.equal(
    searchHistory(reopened.statements, sessionId, 'interrupted', 10).length,
    1,
  );
  reopened.close();
});

test('restart completes an interrupted swipe without losing its sibling', async (context) => {
  const { root, storage } = await fixture(context);
  const sessionId = createSession(storage);
  const first = admitReply(storage, sessionId, 'Hello');
  finish(storage, sessionId, first, 'First');
  storage.admitAttempt({
    sessionId,
    target: { kind: 'swipe', positionId: first.positionId },
    variantId: randomUUID(),
    now,
  });
  storage.close();

  const reopened = await openStorage(
    join(root, 'app.db'),
    schema,
    join(root, 'attachments'),
  );
  const assistant = reopened.projection(sessionId).page.positions[1];
  assert.equal(assistant?.role, 'assistant');
  assert.equal(assistant.variantCount, 2);
  assert.match(assistant.variant.source, /^<system_error>/u);
  reopened.close();
});

test('a committed leaf is active immediately and remains active across a swipe', async (context) => {
  const { storage } = await fixture(context);
  const sessionId = createSession(storage);
  const first = admitReply(storage, sessionId, 'One');
  finish(storage, sessionId, first, 'First');
  storage.acceptPosition(sessionId, first.positionId, now);
  const second = admitReply(storage, sessionId, 'Two');
  finish(storage, sessionId, second, 'Second');
  const leaf = storage.createPendingLeaf({
    sessionId,
    liveTailExchanges: 1,
    now,
  });
  assert.ok(leaf !== null);
  assert.equal(storage.contextEvidence(sessionId, 10, 'UTC').canCompact, false);
  storage.commitLeaf(leaf.id, 'active summary', 'model', now);
  assert.equal(storage.loadSession(sessionId, 10)?.leaves.length, 1);
  assert.equal(
    searchHistory(storage.statements, sessionId, 'active', 10).length,
    1,
  );

  const swipe = storage.admitAttempt({
    sessionId,
    target: { kind: 'swipe', positionId: second.positionId },
    variantId: randomUUID(),
    now,
  });
  finish(storage, sessionId, swipe, 'New swipe');
  assert.equal(storage.loadSession(sessionId, 10)?.leaves.length, 1);
});

test('context evidence shows the leaves the cap admits, not the archive', async (context) => {
  const { storage } = await fixture(context);
  const sessionId = createSession(storage);
  const summaries = ['oldest summary', 'middle summary', ''];
  for (let turn = 0; turn < 4; turn += 1) {
    const admitted = admitReply(storage, sessionId, `Turn ${String(turn)}`);
    finish(storage, sessionId, admitted, `Answer ${String(turn)}`);
    storage.acceptPosition(sessionId, admitted.positionId, now);
    const leaf = storage.createPendingLeaf({
      sessionId,
      liveTailExchanges: 1,
      now,
    });
    if (leaf === null) continue;
    storage.commitLeaf(leaf.id, summaries[turn - 1] ?? '', 'model', now);
  }

  const evidence = storage.contextEvidence(sessionId, 2, 'UTC');
  assert.deepEqual(
    evidence.leaves.map((leaf) => leaf.summary),
    ['middle summary', ''],
  );
  assert.equal(evidence.exactFromExchange, 4);
  assert.equal(evidence.currentExchange, 4);
  assert.deepEqual(
    evidence.leaves.map(({ startExchange, endExchange }) => [
      startExchange,
      endExchange,
    ]),
    [
      [2, 2],
      [3, 3],
    ],
  );
  assert.equal(
    searchHistory(storage.statements, sessionId, 'oldest', 10).length,
    1,
  );

  const greeted = randomUUID();
  storage.createSession({
    id: greeted,
    botSlug: 'echo',
    presetSlug: 'default',
    greetings: ['Hello'],
    now,
  });
  for (let turn = 0; turn < 3; turn += 1) {
    const admitted = admitReply(storage, greeted, `Turn ${String(turn)}`);
    finish(storage, greeted, admitted, `Answer ${String(turn)}`);
    storage.acceptPosition(greeted, admitted.positionId, now);
  }
  const leaf = storage.createPendingLeaf({
    sessionId: greeted,
    liveTailExchanges: 1,
    now,
  });
  assert.ok(leaf !== null);
  storage.commitLeaf(leaf.id, 'Greeting and earlier turns', 'model', now);
  const greetedEvidence = storage.contextEvidence(greeted, 2, 'UTC');
  assert.equal(greetedEvidence.exactFromExchange, 4);
  assert.equal(greetedEvidence.currentExchange, 4);
  assert.deepEqual(
    greetedEvidence.leaves.map(({ startExchange, endExchange }) => [
      startExchange,
      endExchange,
    ]),
    [[1, 3]],
  );
  const scheduled = admitReply(
    storage,
    greeted,
    '<scheduled_event name="Check in" ran_at="2026-08-23T12:00:00.000Z">\nCheck in.\n</scheduled_event>',
  );
  finish(storage, greeted, scheduled, 'Scheduled answer');
  const nextLeaf = storage.createPendingLeaf({
    sessionId: greeted,
    liveTailExchanges: 1,
    now,
  });
  assert.ok(nextLeaf);
  storage.commitLeaf(nextLeaf.id, 'Next exchange', 'model', now);
  const scheduledEvidence = storage.contextEvidence(greeted, 2, 'UTC');
  assert.equal(scheduledEvidence.currentExchange, 5);
  assert.equal(scheduledEvidence.exactFromExchange, 5);
  assert.deepEqual(
    scheduledEvidence.leaves.map(({ startExchange, endExchange }) => [
      startExchange,
      endExchange,
    ]),
    [
      [1, 3],
      [4, 4],
    ],
  );
});

test('startup fallback publishes an interrupted pending leaf', async (context) => {
  const { root, storage } = await fixture(context);
  const sessionId = createSession(storage);
  const first = admitReply(storage, sessionId, 'One');
  finish(storage, sessionId, first, 'First');
  storage.acceptPosition(sessionId, first.positionId, now);
  const second = admitReply(storage, sessionId, 'Two');
  finish(storage, sessionId, second, 'Second');
  storage.createPendingLeaf({
    sessionId,
    liveTailExchanges: 1,
    now,
  });
  assert.deepEqual(storage.loadSession(sessionId, 100)?.leaves, []);
  assert.deepEqual(storage.contextEvidence(sessionId, 100, 'UTC').leaves, []);
  storage.close();

  const reopened = await openStorage(
    join(root, 'app.db'),
    schema,
    join(root, 'attachments'),
  );
  assert.equal(
    searchHistory(reopened.statements, sessionId, 'unavailable', 10).length,
    1,
  );
  const fallback = reopened.contextEvidence(sessionId, 100, 'UTC').leaves[0];
  assert.equal(fallback?.state, 'committed');
  assert.equal(fallback.summaryOutcome, 'fallback-unavailable');
  reopened.close();
});

test('session state survives restart without replaying effect history or ordering edits by timestamps', async (context) => {
  const { root, storage } = await fixture(context);
  const sessionId = createSession(storage);
  const admitted = admitReply(storage, sessionId, 'Remember this');
  storage.finalizeVariant({
    sessionId,
    ...admitted,
    source: 'Remembered.',
    trace: [],
    usages: [],
    provider: 'faux',
    model: 'faux-model',
    effects: [
      { type: 'variable_set', arguments: { name: 'mood', value: 'bright' } },
      {
        type: 'schedule_set',
        arguments: {
          name: 'Morning',
          expression: '0 9 * * *',
          prompt: 'Check in.',
          enabled: true,
        },
      },
    ],
    completedAt: now,
  });
  storage.setVariable(sessionId, 'mood', 'operator', now);
  assert.equal(storage.sessionVariables(sessionId).mood, 'operator');
  assert.deepEqual(storage.listSchedules(sessionId), []);
  storage.acceptPosition(sessionId, admitted.positionId, now);
  assert.equal(await storage.drainEffects(sessionId, now, 'UTC'), true);
  assert.equal(storage.sessionVariables(sessionId).mood, 'bright');
  storage.putSchedule(
    {
      id: randomUUID(),
      sessionId,
      name: 'Paused',
      expression: '0 10 * * *',
      prompt: 'Wait.',
      enabled: false,
      now,
    },
    'UTC',
  );

  const evidence = storage.contextEvidence(sessionId, 5, 'UTC', new Date(now));
  assert.deepEqual(evidence.variables, [
    {
      name: 'mood',
      value: 'bright',
    },
  ]);
  const otherSession = createSession(storage);
  storage.setVariable(otherSession, 'mood', 'separate', now);
  assert.deepEqual(storage.listSchedules(otherSession), []);
  const schedule = storage.listSchedules(sessionId)[0];
  assert.ok(schedule);
  assert.throws(
    () =>
      storage.putSchedule({ ...schedule, sessionId: otherSession, now }, 'UTC'),
    /Schedule not found/u,
  );
  assert.equal(evidence.canCompact, false);
  assert.equal(
    evidence.schedules.find(({ name }) => name === 'Morning')?.nextRunAt,
    '2026-08-24T09:00:00.000Z',
  );
  assert.equal(
    evidence.schedules.find(({ name }) => name === 'Paused')?.nextRunAt,
    null,
  );

  // Wall-clock order and old applied effects never override a later edit.
  storage.setVariable(sessionId, 'mood', 'edited', '2026-08-22T12:00:00.000Z');
  assert.equal(storage.sessionVariables(sessionId).mood, 'edited');
  storage.deleteVariable(sessionId, 'mood', now);
  const schedules = storage.listSchedules(sessionId);
  storage.close();
  const reopened = await openStorage(
    join(root, 'app.db'),
    schema,
    join(root, 'attachments'),
  );
  context.after(() => reopened.close());
  assert.deepEqual(reopened.sessionVariables(sessionId), {});
  assert.deepEqual(reopened.sessionVariables(otherSession), {
    mood: 'separate',
  });
  assert.deepEqual(reopened.listSchedules(sessionId), schedules);
  const response = reopened.projection(sessionId).page.positions[1];
  assert.equal(response?.role, 'assistant');
  assert.equal(response.variant.effects[0]?.state, 'applied');
  reopened.setVariable(sessionId, 'temporary', 'value', now);
  await reopened.deleteSession(sessionId);
  assert.deepEqual(reopened.sessionVariables(sessionId), {});
  assert.deepEqual(reopened.listSchedules(sessionId), []);
  assert.deepEqual(reopened.sessionVariables(otherSession), {
    mood: 'separate',
  });
});

test('operator variable rename is atomic and writes no effect history', async (context) => {
  const { storage } = await fixture(context);
  const sessionId = createSession(storage);
  storage.setVariable(sessionId, 'first', 'one', now);
  storage.setVariable(sessionId, 'second', 'two', now);
  assert.throws(
    () => storage.setVariable(sessionId, 'second', 'renamed', now, 'first'),
    /already exists/u,
  );
  assert.deepEqual(storage.sessionVariables(sessionId), {
    first: 'one',
    second: 'two',
  });
  storage.setVariable(sessionId, 'third', 'three', now, 'first');
  assert.deepEqual(storage.sessionVariables(sessionId), {
    second: 'two',
    third: 'three',
  });
  for (let index = 2; index < 256; index += 1)
    storage.setVariable(sessionId, `key${String(index)}`, 'value', now);
  assert.throws(
    () => storage.setVariable(sessionId, 'extra', 'value', now),
    /limit/u,
  );
  storage.setVariable(sessionId, 'renamed', 'replacement', now, 'third');
  storage.setVariable(sessionId, 'second', 'updated', now);
  assert.equal(storage.sessionVariables(sessionId).renamed, 'replacement');
  assert.equal(storage.sessionVariables(sessionId).second, 'updated');
  assert.deepEqual(
    storage.connection.prepare('SELECT * FROM effects').all(),
    [],
  );
});

test('queued compaction persists model, clipped, and unavailable outcomes', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const presetPath = join(fixture.root, 'presets', 'default.json');
  const preset = presetSchema.parse(
    JSON.parse(await readFile(presetPath, 'utf8')),
  );
  preset.context.liveTailExchanges = 1;
  await writeFile(presetPath, JSON.stringify(preset));

  async function compactWith(
    response: ReturnType<typeof fauxAssistantMessage>,
  ) {
    const sessionId = createSession(fixture.runtime.storage);
    const first = admitReply(fixture.runtime.storage, sessionId, 'One');
    finish(fixture.runtime.storage, sessionId, first, 'First');
    fixture.runtime.storage.acceptPosition(sessionId, first.positionId, now);
    const second = admitReply(fixture.runtime.storage, sessionId, 'Two');
    finish(fixture.runtime.storage, sessionId, second, 'Second');
    fixture.faux.setResponses([response]);
    await fixture.runtime.attempts.requestCompaction(sessionId);
    return fixture.runtime.storage.contextEvidence(sessionId, 100, 'UTC')
      .leaves[0];
  }

  const model = await compactWith(fauxAssistantMessage('Short summary.'));
  assert.equal(model?.state, 'committed');
  assert.equal(model.summaryOutcome, 'model');

  const clipped = await compactWith(fauxAssistantMessage('x'.repeat(7_000)));
  assert.equal(clipped?.state, 'committed');
  assert.equal(clipped.summaryOutcome, 'fallback-clipped');
  assert.equal(clipped.summary.endsWith(SUMMARY_CLIPPED), true);

  const unavailable = await compactWith(
    fauxAssistantMessage('Failed.', { stopReason: 'error' }),
  );
  assert.equal(unavailable?.state, 'committed');
  assert.equal(unavailable.summaryOutcome, 'fallback-unavailable');
});

for (const prior of [null, ''])
  test('summarization uses the chat macro path and exact provider payload', async (context) => {
    const fixture = await createTestFixture();
    context.after(() => fixture.runtime.close());
    const presetPath = join(fixture.root, 'presets', 'default.json');
    const preset = presetSchema.parse(
      JSON.parse(await readFile(presetPath, 'utf8')),
    );
    preset.prompts.summarization =
      'Summarize {{char}} for {{user}} with {{getvar::mood}} on {{date}} using {{model}}.';
    preset.context.liveTailExchanges = 1;
    preset.persona.description = '{{user}} trusts {{char}}.';
    await writeFile(presetPath, JSON.stringify(preset));
    const cardPath = join(fixture.root, 'bots', 'echo', 'echo.json');
    const card = cardSchema.parse(JSON.parse(await readFile(cardPath, 'utf8')));
    card.data.description = '{{char}} helps {{user}}.';
    card.data.scenario = '{{user}} tests {{char}} with {{listvars}}.';
    await writeFile(cardPath, JSON.stringify(card));

    const sessionId = createSession(fixture.runtime.storage);
    fixture.runtime.storage.setVariable(sessionId, 'mood', 'bright', now);
    const first = admitReply(fixture.runtime.storage, sessionId, 'One');
    finish(fixture.runtime.storage, sessionId, first, 'First');
    fixture.runtime.storage.acceptPosition(sessionId, first.positionId, now);
    const second = admitReply(fixture.runtime.storage, sessionId, 'Two');
    finish(fixture.runtime.storage, sessionId, second, 'Second');
    if (prior !== null) {
      const storage = fixture.runtime.storage;
      const leaf = storage.createPendingLeaf({
        sessionId,
        liveTailExchanges: 1,
        now,
      });
      assert.ok(leaf);
      storage.commitLeaf(leaf.id, 'old summary', 'model', now);
      const response = await fixture.runtime.app.inject({
        method: 'PATCH',
        url: `/api/sessions/${sessionId}/leaves/${leaf.id}/source`,
        payload: { source: '   ' },
      });
      assert.equal(response.statusCode, 204);
      assert.equal(
        storage.contextEvidence(sessionId, 1, 'UTC').canCompact,
        false,
      );
      storage.acceptPosition(sessionId, second.positionId, now);
      const third = admitReply(storage, sessionId, 'Three');
      const assembly = await assembleAttempt({
        sessionId,
        ...third,
        storage,
        authored: new AuthoredFiles(fixture.root),
        capabilities: fixture.runtime.capabilities,
        models: fixture.models,
        now: new Date(now),
      });
      assert.doesNotMatch(
        JSON.stringify(assembly.context.messages),
        /conversation_memory|First/,
      );
      assert.equal(
        searchHistory(storage.statements, sessionId, 'old summary', 10).length,
        0,
      );
      finish(storage, sessionId, third, 'Third');
    }
    fixture.faux.setResponses([
      (providerContext) => {
        assert.equal(
          getCurrentSystemPrompt(providerContext.messages),
          `Summarize Echo for User with bright on August 23, 2026 using ${fixture.faux.getModel().id}.`,
        );
        assert.deepEqual(
          providerContext.messages.filter(
            (message) => message.role !== 'system',
          ),
          [
            {
              role: 'user',
              content: [
                'Bot: Echo',
                'Bot description:\nEcho helps User.',
                'Scenario:\nUser tests Echo with mood: bright.',
                'User persona (User):\nUser trusts Echo.',
                `Previous leaf (continuity reference only; do not summarize or restate):\n${prior === null ? '(none)' : '<empty_summary/>'}`,
                `New transcript to summarize:\nUser:\n${prior === null ? 'One\n\nAssistant:\nFirst' : 'Two\n\nAssistant:\nSecond'}`,
              ].join('\n\n'),
              timestamp: Date.parse(now),
            },
          ],
        );
        return fauxAssistantMessage('First exchange summarized.');
      },
    ]);

    await compactSession({
      sessionId,
      storage: fixture.runtime.storage,
      authored: new AuthoredFiles(fixture.root),
      models: fixture.models,
      signal: new AbortController().signal,
      now: () => new Date(now),
    });
    assert.equal(
      fixture.runtime.storage
        .contextEvidence(sessionId, 100, 'UTC')
        .leaves.at(-1)?.summary,
      'First exchange summarized.',
    );
  });

test('the ingress FIFO is global and queued cancellation never admits', async (context) => {
  const runtimeFixture = await createTestFixture();
  context.after(() => disposeTestFixture(runtimeFixture));
  const firstSession = createSession(runtimeFixture.runtime.storage);
  const secondSession = createSession(runtimeFixture.runtime.storage);
  const started = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  runtimeFixture.faux.setResponses([
    async () => {
      started.resolve(undefined);
      await release.promise;
      return fauxAssistantMessage('First complete.');
    },
  ]);
  const first = runtimeFixture.runtime.attempts.enqueue({
    sessionId: firstSession,
    command: { kind: 'reply', text: 'First' },
    emit: () => undefined,
  });
  const events: string[] = [];
  const second = runtimeFixture.runtime.attempts.enqueue({
    id: randomUUID(),
    sessionId: secondSession,
    command: { kind: 'reply', text: 'Second' },
    emit: (event) => events.push(event.type),
  });
  await started.promise;
  assert.equal(
    runtimeFixture.runtime.attempts.cancel(secondSession, second.id),
    true,
  );
  await second.done;
  assert.deepEqual(events, ['queued']);
  assert.deepEqual(
    runtimeFixture.runtime.storage.projection(secondSession).page.positions,
    [],
  );
  release.resolve(undefined);
  await first.done;
});

for (const toolCount of [1, 2]) {
  test(`Stop after the first of ${String(toolCount)} tools prevents later tools and model calls`, async (context) => {
    const fixture = await createTestFixture();
    context.after(() => fixture.runtime.close());
    const { storage, attempts } = fixture.runtime;
    const sessionId = createSession(storage);
    let modelCalls = 0;
    fixture.faux.setResponses([
      () => {
        modelCalls += 1;
        return fauxAssistantMessage(
          [
            fauxToolCall('system__variable_set', {
              name: 'first',
              value: 'kept',
            }),
            fauxToolCall('system__variable_set', {
              name: 'second',
              value: 'stopped',
            }),
          ].slice(0, toolCount),
          { stopReason: 'toolUse' },
        );
      },
      () => {
        modelCalls += 1;
        return fauxAssistantMessage('Should not run.');
      },
    ]);
    const attempt = attempts.enqueue({
      sessionId,
      command: { kind: 'reply', text: 'Set two variables.' },
      emit(event) {
        if (event.type === 'tool_result')
          attempts.cancel(sessionId, event.attemptId);
      },
    });
    await attempt.done;
    const response = storage.projection(sessionId).page.positions.at(-1);
    assert.equal(response?.role, 'assistant');
    assert.match(response.variant.source, /Generation stopped by operator/u);
    assert.deepEqual(
      response.variant.effects.map((effect) => effect.arguments.name),
      ['first'],
    );
    assert.equal(modelCalls, 1);
  });
}

test('invalid config refuses acceptance before locking or admitting effects', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const { storage } = fixture.runtime;
  const sessionId = createSession(storage);
  const admitted = seedExchange(fixture, {
    sessionId,
    user: 'Remember the mood.',
    assistant: 'Noted.',
    now,
    effects: [
      { type: 'variable_set', arguments: { name: 'mood', value: 'calm' } },
    ],
  });
  const configPath = join(fixture.root, 'config.json');
  const config = await readFile(configPath, 'utf8');
  await writeFile(configPath, '{}');
  const url = `/api/sessions/${sessionId}/positions/${admitted.positionId}/accept`;
  const refused = await fixture.runtime.app.inject({ method: 'POST', url });
  assert.equal(refused.statusCode, 400);
  const response = storage.projection(sessionId).page.positions.at(-1);
  assert.equal(response?.role, 'assistant');
  assert.equal(response.locked, false);
  assert.equal(response.variant.effects[0]?.state, 'candidate');
  assert.deepEqual(storage.sessionVariables(sessionId), {});
  await writeFile(configPath, config);
  const accepted = await fixture.runtime.app.inject({ method: 'POST', url });
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.deepEqual(storage.sessionVariables(sessionId), { mood: 'calm' });
});

test('internal state and effect evidence commit together; failed writes do not block later effects', async (context) => {
  const { storage } = await fixture(context);
  const sessionId = createSession(storage);
  const admitted = admitReply(storage, sessionId, 'Update session state');
  storage.finalizeVariant({
    sessionId,
    ...admitted,
    source: 'Prepared.',
    trace: [],
    usages: [],
    provider: 'faux',
    model: 'faux-model',
    effects: [
      { type: 'variable_set', arguments: { name: 'rejected', value: 'value' } },
      {
        type: 'schedule_set',
        arguments: {
          name: 'Rejected',
          expression: '0 9 * * *',
          prompt: 'Check in.',
          enabled: true,
        },
      },
      { type: 'variable_set', arguments: { name: 'kept', value: 'value' } },
      { type: 'variable_delete', arguments: { name: 'already_absent' } },
    ],
    completedAt: now,
  });
  storage.connection.exec(`
    CREATE TRIGGER reject_effect_completion BEFORE UPDATE OF state ON effects
    WHEN NEW.state = 'applied' AND NEW.ordinal < 2
    BEGIN SELECT RAISE(ABORT, 'Evidence write failed'); END;
  `);
  assert.deepEqual(storage.sessionVariables(sessionId), {});
  assert.deepEqual(storage.listSchedules(sessionId), []);
  storage.acceptPosition(sessionId, admitted.positionId, now);
  assert.equal(await storage.drainEffects(sessionId, now, 'UTC'), false);
  assert.deepEqual(storage.sessionVariables(sessionId), { kept: 'value' });
  assert.deepEqual(storage.listSchedules(sessionId), []);
  const response = storage.projection(sessionId).page.positions[1];
  if (response?.role !== 'assistant') throw new Error('Missing response');
  assert.deepEqual(
    response.variant.effects.map(({ state }) => state),
    ['failed', 'failed', 'applied', 'applied'],
  );
});

test('external effect outcomes preserve definite and uncertain failures', async (context) => {
  const { storage } = await fixture(context);
  const sessionId = createSession(storage);
  const admitted = admitReply(storage, sessionId, 'Write remotely');
  storage.finalizeVariant({
    sessionId,
    ...admitted,
    source: 'Prepared.',
    trace: [],
    usages: [],
    provider: 'faux',
    model: 'faux-model',
    effects: [
      { type: 'mcp:mcp__remote__fail', arguments: {} },
      { type: 'mcp:mcp__remote__uncertain', arguments: {} },
    ],
    completedAt: now,
  });
  storage.acceptPosition(sessionId, admitted.positionId, now);
  await storage.drainEffects(sessionId, now, 'UTC', async (type) =>
    type.endsWith('__fail')
      ? { state: 'failed', result: 'Rejected by provider' }
      : { state: 'unresolved', result: 'Connection closed after dispatch' },
  );
  const assistant = storage.projection(sessionId).page.positions[1];
  if (assistant?.role !== 'assistant') throw new Error('Missing response');
  assert.deepEqual(
    assistant.variant.effects.map(({ state, result }) => ({ state, result })),
    [
      { state: 'failed', result: 'Rejected by provider' },
      { state: 'unresolved', result: 'Connection closed after dispatch' },
    ],
  );
});

test('restart marks an interrupted accepted effect unresolved without replay', async (context) => {
  const { root, storage } = await fixture(context);
  const sessionId = createSession(storage);
  const admitted = admitReply(storage, sessionId, 'Write remotely');
  storage.finalizeVariant({
    sessionId,
    ...admitted,
    source: 'Prepared.',
    trace: [],
    usages: [],
    provider: 'faux',
    model: 'faux-model',
    effects: [{ type: 'mcp:mcp__remote__write', arguments: {} }],
    completedAt: now,
  });
  storage.acceptPosition(sessionId, admitted.positionId, now);
  storage.close();

  const reopened = await openStorage(
    join(root, 'app.db'),
    schema,
    join(root, 'attachments'),
  );
  const assistant = reopened.projection(sessionId).page.positions[1];
  if (assistant?.role !== 'assistant') throw new Error('Missing response');
  assert.deepEqual(
    assistant.variant.effects.map(({ state, result }) => ({ state, result })),
    [{ state: 'unresolved', result: null }],
  );
  reopened.close();
});

interface TestContext {
  after(callback: () => void | Promise<void>): void;
}

test('an unprojectable schedule keeps its siblings firing and stays visible', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const session = fixture.runtime.storage.createSession({
    id: randomUUID(),
    botSlug: 'help',
    presetSlug: 'default',
    now: new Date().toISOString(),
  });
  const now = new Date().toISOString();
  fixture.runtime.storage.putSchedule(
    {
      id: randomUUID(),
      sessionId: session.id,
      name: 'Healthy',
      expression: '0 * * * *',
      prompt: 'Check in',
      enabled: true,
      now,
    },
    'UTC',
  );
  // Expressions are validated on write, so corruption is the only way in.
  const broken = randomUUID();
  fixture.runtime.storage.putSchedule(
    {
      id: broken,
      sessionId: session.id,
      name: 'Broken',
      expression: '0 * * * *',
      prompt: 'Check in',
      enabled: true,
      now,
    },
    'UTC',
  );
  fixture.runtime.storage.connection
    .prepare(`UPDATE schedules SET expression = 'not a cron' WHERE id = ?`)
    .run(broken);

  // The timer survives the bad row rather than taking the process with it.
  assert.doesNotThrow(() => fixture.runtime.cron.wake());

  const projected = fixture.runtime.storage.contextEvidence(
    session.id,
    8,
    'UTC',
    new Date(),
    1,
  ).schedules;
  const healthy = projected.find((schedule) => schedule.name === 'Healthy');
  const unreadable = projected.find((schedule) => schedule.name === 'Broken');
  assert.ok(healthy !== undefined);
  assert.ok(unreadable !== undefined);
  assert.notEqual(healthy.nextRunAt, null);
  assert.equal(healthy.nextRunError, null);
  // Skipped by the timer, but never hidden from the operator who must fix it.
  assert.equal(unreadable.nextRunAt, null);
  assert.ok((unreadable.nextRunError ?? '').length > 0);
});

test('a session projects one title from its opening message of either role', async (context) => {
  const { storage } = await fixture(context);
  const greeted = randomUUID();
  storage.createSession({
    id: greeted,
    botSlug: 'echo',
    presetSlug: 'default',
    greetings: [`*You wake with a start, recalling the ${'long '.repeat(40)}`],
    now,
  });
  const empty = createSession(storage);

  const titles = new Map(
    storage.listSessions().map((session) => [session.id, session.title]),
  );
  // The opening is the bot's greeting, so the title comes from it.
  assert.equal(
    titles.get(greeted),
    '*You wake with a start, recalling the long long long long lo',
  );
  assert.equal(titles.get(greeted)?.length, 60);
  assert.equal(titles.get(empty), 'New conversation');

  storage.setSessionTitle(greeted, 'Morning walk', now);
  assert.equal(
    storage.listSessions().find((session) => session.id === greeted)?.title,
    'Morning walk',
  );
});

test('context exchange ranges stay session-local across large active leaf caps', async (context) => {
  const { storage } = await fixture(context);
  const sessionId = createSession(storage);
  for (let turn = 0; turn < 103; turn++) {
    const admitted = admitReply(storage, sessionId, `Turn ${String(turn)}`);
    finish(storage, sessionId, admitted, `Answer ${String(turn)}`);
    storage.acceptPosition(sessionId, admitted.positionId, now);
    const leaf = storage.createPendingLeaf({
      sessionId,
      liveTailExchanges: 1,
      now,
    });
    if (leaf) storage.commitLeaf(leaf.id, 'Summary', 'model', now);
  }
  const empty = createSession(storage);
  assert.equal(storage.contextEvidence(empty, 200, 'UTC').currentExchange, 0);
  const evidence = storage.contextEvidence(sessionId, 200, 'UTC');
  assert.equal(evidence.currentExchange, 103);
  assert.equal(evidence.exactFromExchange, 103);
  assert.deepEqual(
    evidence.leaves.map(({ startExchange, endExchange }) => [
      startExchange,
      endExchange,
    ]),
    Array.from({ length: 102 }, (_, i) => [i + 1, i + 1]),
  );
});
