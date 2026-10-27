import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import Database from 'better-sqlite3';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { runCli } from './cli.js';
import { SCHEMA } from './root.js';
import { openStorage } from './storage.js';
import { acquireRuntimeOwnership } from './runtime-ownership.js';
import { createTestFixture, disposeTestFixture } from './test-helper.js';

// Port 0 also proves that changing the listener cannot bypass root ownership.
test('a duplicate CLI start leaves a live reply and all database facts untouched', async (t) => {
  const fixture = await createTestFixture();
  const started = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  t.after(async () => {
    release.resolve(undefined);
    await disposeTestFixture(fixture);
  });
  fixture.faux.setResponses([
    async () => {
      started.resolve(undefined);
      await release.promise;
      return fauxAssistantMessage('The original answer survived.');
    },
  ]);
  const sessionId = randomUUID();
  fixture.runtime.storage.createSession({
    id: sessionId,
    botSlug: 'echo',
    presetSlug: 'default',
    now: new Date().toISOString(),
  });
  const attempt = fixture.runtime.attempts.enqueue({
    sessionId,
    command: { kind: 'reply', text: 'Keep this reply.' },
    emit: () => undefined,
  });
  await started.promise;
  const before = fixture.runtime.storage.connection.serialize();
  const errors: string[] = [];
  assert.equal(
    await runCli(
      ['start'],
      {
        out: () => undefined,
        error: (line) => errors.push(line),
        confirm: async () => '',
      },
      {
        SIMPLEBOT_ROOT: fixture.root,
        SIMPLEBOT_HOST: '127.0.0.1',
        SIMPLEBOT_PORT: '0',
      },
    ),
    1,
  );
  assert.match(errors.join('\n'), /Another SimpleBot runtime owns this root/u);
  assert.deepEqual(fixture.runtime.storage.connection.serialize(), before);
  release.resolve(undefined);
  await attempt.done;
  const position = fixture.runtime.storage
    .projection(sessionId)
    .page.positions.at(-1);
  assert.ok(position?.role === 'assistant');
  assert.equal(position.variant.source, 'The original answer survived.');
});

test('process death releases ownership and the next startup completes the interrupted reply', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'simplebot-owner-crash-'));
  const databasePath = join(root, 'app.db');
  const attachments = join(root, 'attachments');
  const module = pathToFileURL(resolve(import.meta.dirname, 'storage.ts')).href;
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `
    import { openStorage } from ${JSON.stringify(module)};
    const storage = await openStorage(process.env.TEST_DB, process.env.TEST_SCHEMA, process.env.TEST_ATTACHMENTS);
    storage.createSession({id: 'session', botSlug: 'echo', presetSlug: 'default', now: new Date().toISOString()});
    storage.admitAttempt({sessionId: 'session', target: {kind: 'reply', source: 'Interrupted'}, variantId: 'variant', now: new Date().toISOString()});
    process.send('ready');
    setInterval(() => {}, 60_000);
  `,
    ],
    {
      cwd: resolve(import.meta.dirname, '../..'),
      env: {
        ...process.env,
        TEST_DB: databasePath,
        TEST_SCHEMA: SCHEMA,
        TEST_ATTACHMENTS: attachments,
      },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    },
  );
  let errors = '';
  assert.ok(child.stderr);
  child.stderr.on('data', (chunk: Buffer) => {
    errors += chunk.toString();
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  });
  const ready: unknown[] = await once(child, 'message', {
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(ready[0], 'ready', errors);
  const reader = new Database(databasePath, { readonly: true });
  const before = reader.serialize();
  try {
    await assert.rejects(
      openStorage(databasePath, SCHEMA, attachments),
      /Another SimpleBot runtime/u,
    );
    assert.deepEqual(reader.serialize(), before);
  } finally {
    reader.close();
  }
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
  const storage = await openStorage(databasePath, SCHEMA, attachments);
  try {
    const position = storage.projection('session').page.positions.at(-1);
    assert.ok(position?.role === 'assistant');
    assert.match(
      position.variant.source,
      /Generation interrupted by application restart/u,
    );
    assert.equal((await readFile(`${databasePath}.runtime-lock`)).length, 0);
  } finally {
    storage.close();
  }
});

test('schema refusal releases runtime ownership without changing the database', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'simplebot-owner-refusal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const databasePath = join(root, 'app.db');
  const database = new Database(databasePath);
  database.exec('CREATE TABLE wrong (value TEXT); PRAGMA user_version = 999');
  database.close();
  await assert.rejects(
    openStorage(databasePath, SCHEMA, join(root, 'attachments')),
    /does not match schema/u,
  );
  const release = await acquireRuntimeOwnership(databasePath);
  release();
  const reader = new Database(databasePath, { readonly: true });
  try {
    assert.equal(reader.pragma('user_version', { simple: true }), 999);
  } finally {
    reader.close();
  }
});
