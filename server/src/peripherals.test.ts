import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
  chmod,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { bootstrapSchema } from '@simplebot/shared';

import { fauxAssistantMessage } from '@earendil-works/pi-ai';

import { AuthoredConflictError, AuthoredFiles } from './authored.js';
import { authCookies, clearedAuthCookies, readAuthCookie } from './auth.js';
import { SecretStore } from './secrets.js';
import { resolveCredential } from './credentials.js';
import { SessionCron } from './cron.js';
import {
  createBackup,
  doctor,
  restoreBackup,
  verifyBackup,
} from './operations.js';
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

test('Context projects next schedule runs and scheduled occurrences use the ordinary attempt path', async (context) => {
  let at = new Date('2026-08-23T12:00:00.000Z');
  const fixture = await createTestFixture({ clock: () => at });
  context.after(() => disposeTestFixture(fixture));
  const address = await listen(fixture.runtime);
  const sessionId = await createSession(address);
  const created = await fetch(
    `${address}/api/sessions/${sessionId}/schedules`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Check in',
        expression: '* * * * * *',
        prompt: 'Offer a check-in',
        enabled: true,
      }),
    },
  );
  assert.equal(created.status, 204);
  const createdProjection = (await (
    await fetch(`${address}/api/sessions/${sessionId}/context`)
  ).json()) as {
    schedules: { id: string; nextRunAt: string | null }[];
  };
  const schedule = createdProjection.schedules[0];
  assert.ok(schedule);
  assert.notEqual(schedule.nextRunAt, null);
  const sibling = await fetch(
    `${address}/api/sessions/${sessionId}/schedules`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Second check-in',
        expression: '* * * * * *',
        prompt: 'Offer another check-in',
        enabled: true,
      }),
    },
  );
  assert.equal(sibling.status, 204);
  fixture.faux.setResponses([
    fauxAssistantMessage('Checking in'),
    fauxAssistantMessage('Checking in again'),
  ]);
  const enqueue = context.mock.method(fixture.runtime.attempts, 'enqueue');
  // Close the real timer before replacing timer APIs; mocked clearTimeout
  // cannot cancel a timer created before mocks were enabled.
  fixture.runtime.cron.close();
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const cron = new SessionCron(
    fixture.runtime.storage,
    fixture.runtime.attempts,
    'UTC',
    () => at,
  );
  cron.start();
  at = new Date('2026-08-23T12:00:01.000Z');
  context.mock.timers.tick(1_000);
  cron.close();
  context.mock.timers.reset();
  assert.equal(enqueue.mock.callCount(), 2);
  await Promise.all(
    enqueue.mock.calls.map(({ result }) => {
      assert.ok(result);
      return result.done;
    }),
  );
  const response = await fetch(`${address}/api/sessions/${sessionId}`);
  assert.equal(response.status, 200);
  const projection = (await response.json()) as {
    page: { positions: { role: string; source?: string }[] };
  };
  // The stored occurrence carries the prompt the model actually answered, so a
  // later swipe of this position reassembles the same user turn.
  const occurrences = projection.page.positions
    .filter((position) => position.role === 'user')
    .map((position) => position.source ?? '');
  assert.ok(occurrences.every((source) => source.includes('scheduled_event')));
  assert.ok(occurrences.some((source) => source.includes('Offer a check-in')));
  assert.ok(
    occurrences.some((source) => source.includes('Offer another check-in')),
  );
  const contextProjection = (await (
    await fetch(`${address}/api/sessions/${sessionId}/context`)
  ).json()) as { schedules: { id: string }[] };
  assert.ok(
    contextProjection.schedules.some((item) => item.id === schedule.id),
  );
  assert.equal(contextProjection.schedules.length, 2);
  assert.equal(occurrences.length, 2);
});

test('every schedule follows the current application timezone', async (context) => {
  const at = new Date('2026-01-15T12:00:00.000Z');
  const fixture = await createTestFixture({ clock: () => at });
  context.after(() => disposeTestFixture(fixture));
  const address = await listen(fixture.runtime);
  const sessionId = await createSession(address);
  const created = await fetch(
    `${address}/api/sessions/${sessionId}/schedules`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Morning',
        expression: '0 9 * * *',
        prompt: 'Say good morning',
        enabled: true,
      }),
    },
  );
  assert.equal(created.status, 204);

  async function nextRun(): Promise<{
    timezone: string;
    schedules: { nextRunAt: string | null; timezone?: string }[];
  }> {
    return (await (
      await fetch(`${address}/api/sessions/${sessionId}/context`)
    ).json()) as {
      timezone: string;
      schedules: { nextRunAt: string | null; timezone?: string }[];
    };
  }

  const utc = await nextRun();
  assert.equal(utc.timezone, 'UTC');
  const [schedule] = utc.schedules;
  assert.ok(schedule);
  assert.equal(schedule.nextRunAt, '2026-01-16T09:00:00.000Z');
  assert.equal(Object.hasOwn(schedule, 'timezone'), false);

  const settings = (await (await fetch(`${address}/api/settings`)).json()) as {
    value: { application: { timezone: string } };
    revision: string;
  };
  settings.value.application.timezone = 'America/New_York';
  const saved = await fetch(`${address}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      value: settings.value,
      expectedRevision: settings.revision,
    }),
  });
  assert.equal(saved.status, 200);

  const newYork = await nextRun();
  assert.equal(newYork.timezone, 'America/New_York');
  assert.equal(newYork.schedules[0]?.nextRunAt, '2026-01-15T14:00:00.000Z');
});

test('TTS publishes one deterministic complete file and reuses it', async (context) => {
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, 'Bearer synthetic-speech-key');
    response.writeHead(200, { 'content-type': 'audio/mpeg' });
    response.end('audio');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => server.close());
  const addressInfo = server.address();
  if (addressInfo === null || typeof addressInfo === 'string')
    throw new Error('Missing TTS address');
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const configPath = join(fixture.root, 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8')) as Record<
    string,
    unknown
  >;
  const secrets = new SecretStore(fixture.root);
  secrets.write('SPEECH_KEY', 'synthetic-speech-key', secrets.list().revision);
  config.tts = {
    baseUrl: `http://127.0.0.1:${String(addressInfo.port)}/`,
    apiKey: 'secret:SPEECH_KEY',
    model: 'speech',
  };
  await writeFile(configPath, JSON.stringify(config));
  fixture.faux.setResponses([fauxAssistantMessage('Speak this')]);
  const address = await listen(fixture.runtime);
  const sessionId = await createSession(address);
  const completed = (
    await readEvents(
      await streamAttempt(address, sessionId, { kind: 'reply', text: 'Speak' }),
    )
  ).at(-1);
  if (completed?.type !== 'completed') throw new Error('Missing variant');
  // Stored conversation controls and speech do not depend on current bot writing.
  await writeFile(join(fixture.root, 'bots/echo/echo.json'), '{ invalid');
  const bootstrap = bootstrapSchema.parse(
    (await fixture.runtime.app.inject('/api/bootstrap')).json(),
  );
  assert.ok(bootstrap.bots.some((bot) => bot.slug === 'echo'));
  assert.ok(bootstrap.sessions.some((session) => session.id === sessionId));
  assert.equal(
    (await fetch(`${address}/api/sessions/${sessionId}/context`)).status,
    200,
  );
  const first = await fetch(
    `${address}/api/sessions/${sessionId}/variants/${completed.variantId}/speech`,
    { method: 'POST' },
  );
  const firstBody = (await first.json()) as { key: string; cached: boolean };
  assert.equal(firstBody.cached, false);
  const second = await fetch(
    `${address}/api/sessions/${sessionId}/variants/${completed.variantId}/speech`,
    { method: 'POST' },
  );
  assert.equal(((await second.json()) as { cached: boolean }).cached, true);
  assert.equal(
    (await stat(join(fixture.root, 'data', 'tts', firstBody.key))).size,
    5,
  );
  (config.tts as Record<string, unknown>).maxAudioBytes = 4;
  await writeFile(configPath, JSON.stringify(config));
  assert.equal(
    (
      await fetch(
        `${address}/api/sessions/${sessionId}/variants/${completed.variantId}/speech`,
        { method: 'POST' },
      )
    ).status,
    500,
  );
  assert.equal(
    (await readdir(join(fixture.root, 'data', 'tts'))).filter((name) =>
      name.endsWith('.mp3'),
    ).length,
    1,
  );
  const failed = seedExchange(fixture, {
    sessionId,
    user: 'Fail.',
    assistant: '<system_error>Provider failed.</system_error>',
    now: new Date().toISOString(),
  });
  assert.equal(
    (
      await fetch(
        `${address}/api/sessions/${sessionId}/variants/${failed.variantId}/speech`,
        { method: 'POST' },
      )
    ).status,
    500,
  );
});

test('logout clears exactly the cookie pairing issued', () => {
  // Two spellings of one name is how logout silently stops working: the
  // browser keeps a cookie nobody cleared. Both come from one derivation.
  for (const secure of [true, false]) {
    const [issued] = authCookies(
      'token-value',
      '2026-08-24T00:00:00.000Z',
      secure,
    );
    const [cleared] = clearedAuthCookies(secure);
    assert.ok(issued);
    assert.ok(cleared);
    const nameOf = (header: string) => header.slice(0, header.indexOf('='));
    assert.equal(nameOf(cleared), nameOf(issued));
    assert.equal(readAuthCookie(issued, secure), 'token-value');
    assert.equal(readAuthCookie(cleared, secure), undefined);
    assert.equal(cleared.includes('Secure'), secure);
  }
});

test('owner pairing is one-use and backups verify before fresh-root restore', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const auth = fixture.runtime.auth;
  const pairing = auth.issuePairingCode();
  assert.ok(auth.exchange(pairing.code));
  assert.equal(auth.exchange(pairing.code), null);
  auth.setOwnerKey('a-reusable-owner-key');
  assert.ok(auth.exchange('a-reusable-owner-key'));

  const parent = await mkdtemp(join(tmpdir(), 'simplebot-backup-'));
  const backup = join(parent, 'backup');
  await createBackup(fixture.root, backup, fixture.runtime.storage);
  if (process.platform !== 'win32') {
    assert.equal((await stat(backup)).mode & 0o777, 0o700);
    // Modes are not checksum facts. A shared/unpacked backup must not make
    // its restored operator root readable by another local user.
    await chmod(join(backup, 'payload'), 0o755);
  }
  const manifest = await verifyBackup(backup);
  assert.equal(manifest.format, 'simplebot-backup');
  const restored = join(parent, 'restored');
  await restoreBackup(backup, restored);
  if (process.platform !== 'win32')
    assert.equal((await stat(restored)).mode & 0o777, 0o700);
  assert.equal((await stat(join(restored, 'data', 'app.db'))).isFile(), true);
  assert.deepEqual(await doctor(restored, join(restored, 'data', 'app.db')), {
    ok: true,
    findings: [],
  });
});

test('a backup whose database outran its files fails instead of publishing', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const storage = fixture.runtime.storage;
  const now = new Date().toISOString();
  const session = storage.createSession({
    id: randomUUID(),
    botSlug: 'echo',
    presetSlug: 'default',
    now,
  });

  const parent = await mkdtemp(join(tmpdir(), 'simplebot-backup-race-'));
  const backup = join(parent, 'backup');
  await assert.rejects(
    createBackup(fixture.root, backup, {
      // The accepted race, exactly: the payload's files are already copied,
      // and this image lands before the snapshot that will name it.
      async backup(destination) {
        await storage.importAttachment({
          sessionId: session.id,
          filename: 'late.png',
          data: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            'base64',
          ),
          maxDimension: 64,
          now,
        });
        await storage.backup(destination);
      },
    }),
    /missing attachment file/u,
  );

  // Nothing published and no stage left behind, so running it again is the
  // whole remedy.
  assert.deepEqual(await readdir(parent), []);
});

test('doctor accepts renamed presets and empty bot collections but reports a missing collection', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const databasePath = join(fixture.root, 'data', 'app.db');
  await rename(
    join(fixture.root, 'presets', 'default.json'),
    join(fixture.root, 'presets', 'operator.json'),
  );
  await rm(join(fixture.root, 'bots', 'help'), {
    recursive: true,
    force: true,
  });
  assert.deepEqual(await doctor(fixture.root, databasePath), {
    ok: true,
    findings: [],
  });

  await rm(join(fixture.root, 'bots', 'echo'), {
    recursive: true,
    force: true,
  });
  assert.deepEqual(await doctor(fixture.root, databasePath), {
    ok: true,
    findings: [],
  });
  await mkdir(join(fixture.root, 'bots', 'broken'));
  await writeFile(join(fixture.root, 'bots', 'broken', 'broken.json'), '{}');
  assert.deepEqual((await doctor(fixture.root, databasePath)).findings, [
    'No readable bot in bots/',
  ]);
  await rm(join(fixture.root, 'bots'), { recursive: true });
  assert.deepEqual((await doctor(fixture.root, databasePath)).findings, [
    'Missing or unreadable: bots/',
  ]);
});

test('settings preserve credential references and pairing applies on restart', async (context) => {
  process.env.SIMPLEBOT_TEST_PROVIDER_KEY = 'secret';
  context.after(() => delete process.env.SIMPLEBOT_TEST_PROVIDER_KEY);
  const fixture = await createTestFixture();
  let runtime = fixture.runtime;
  context.after(() => runtime.close());
  const configPath = join(fixture.root, 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8')) as {
    providers: Record<string, { apiKey?: string }>;
  };
  const configured = Object.values(config.providers)[0];
  if (configured === undefined) throw new Error('Missing test provider');
  configured.apiKey = '${SIMPLEBOT_TEST_PROVIDER_KEY}';
  await writeFile(configPath, JSON.stringify(config));
  const address = await listen(fixture.runtime);
  const settings = (await (await fetch(`${address}/api/settings`)).json()) as {
    value: {
      application: { loginEnabled: boolean };
      providers: Record<string, { apiKey?: string }>;
    };
    revision: string;
  };
  const provider = Object.values(settings.value.providers)[0];
  assert.equal(provider?.apiKey, '${SIMPLEBOT_TEST_PROVIDER_KEY}');
  settings.value.application.loginEnabled = true;
  const saved = await fetch(`${address}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      value: settings.value,
      expectedRevision: settings.revision,
    }),
  });
  assert.equal(saved.status, 200);
  assert.equal((await fetch(`${address}/api/settings`)).status, 200);
  await runtime.close();
  const reopened = await reopenTestFixture({
    root: fixture.root,
    faux: fixture.faux,
  });
  runtime = reopened.runtime;
  const pairedAddress = await listen(runtime);
  assert.equal((await fetch(`${pairedAddress}/api/settings`)).status, 401);
  const pairing = runtime.auth.issuePairingCode();
  const exchanged = await fetch(`${pairedAddress}/api/auth/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credential: pairing.code }),
  });
  assert.equal(exchanged.status, 200);
  const cookie = exchanged.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(cookie);
  assert.equal(
    (await fetch(`${pairedAddress}/api/settings`, { headers: { cookie } }))
      .status,
    200,
  );
  assert.equal(
    (
      await fetch(`${pairedAddress}/api/settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          value: settings.value,
          expectedRevision: settings.revision,
        }),
      })
    ).status,
    409,
  );
});

test('startup pairing mode gates private state only when enabled', async (context) => {
  const open = await createTestFixture();
  const paired = await createTestFixture({ loginEnabled: true });
  context.after(async () => {
    await Promise.all([open.runtime.close(), paired.runtime.close()]);
  });
  const [openAddress, pairedAddress] = await Promise.all([
    listen(open.runtime),
    listen(paired.runtime),
  ]);
  assert.equal((await fetch(`${openAddress}/api/bootstrap`)).status, 200);
  assert.equal((await fetch(`${pairedAddress}/api/bootstrap`)).status, 401);
  assert.deepEqual(
    await (await fetch(`${openAddress}/api/auth/status`)).json(),
    {
      loginEnabled: false,
      authenticated: false,
    },
  );
  assert.deepEqual(
    await (await fetch(`${pairedAddress}/api/auth/status`)).json(),
    {
      loginEnabled: true,
      authenticated: false,
    },
  );
});

test('settings reject concurrent writes from one revision', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const authored = new AuthoredFiles(fixture.root);
  const current = await authored.readConfig();
  const first = structuredClone(current.value);
  const second = structuredClone(current.value);
  first.application.timezone = 'America/New_York';
  second.application.timezone = 'America/Chicago';

  const results = await Promise.allSettled([
    authored.writeConfig(first, current.revision),
    authored.writeConfig(second, current.revision),
  ]);

  assert.equal(
    results.filter(({ status }) => status === 'fulfilled').length,
    1,
  );
  const rejected = results.find(({ status }) => status === 'rejected');
  assert.ok(rejected?.status === 'rejected');
  assert.ok(rejected.reason instanceof AuthoredConflictError);
  assert.equal(
    (await authored.readConfig()).value.application.timezone,
    'America/New_York',
  );
});

test('settings reject removing a provider used by a preset', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const authored = new AuthoredFiles(fixture.root);
  const current = await authored.readConfig();
  const value = structuredClone(current.value);
  value.providers = {};
  await assert.rejects(
    authored.writeConfig(value, current.revision),
    /is used by preset default/u,
  );
});

test('credential references share one resolution rule', () => {
  assert.throws(
    () => resolveCredential('literal', 'Provider', {}),
    /must be an environment reference/u,
  );
  assert.equal(
    resolveCredential('${TOKEN}', 'Provider', { TOKEN: 'secret' }),
    'secret',
  );
  assert.throws(
    () => resolveCredential('${TOKEN}', 'Provider', {}),
    /Provider credential reference is unavailable/u,
  );
});

test('the built client and compact bootstrap use the server directly', async (context) => {
  const web = await mkdtemp(join(tmpdir(), 'simplebot-web-'));
  await writeFile(
    join(web, 'index.html'),
    '<main id="root">golden client</main>',
  );
  const fixture = await createTestFixture({ web });
  context.after(() => disposeTestFixture(fixture));
  const address = await listen(fixture.runtime);

  assert.match(await (await fetch(address)).text(), /golden client/u);
  const initial = (await (await fetch(`${address}/api/bootstrap`)).json()) as {
    bots: { slug: string }[];
    sessions: unknown[];
  };
  assert.deepEqual(
    initial.bots.map(({ slug }) => slug),
    ['echo', 'help'],
  );
  assert.deepEqual(initial.sessions, []);

  const card = (await (await fetch(`${address}/api/bots/echo`)).json()) as {
    value: { data: Record<string, unknown> };
    revision: string;
  };
  card.value.data.name = 'Echo Updated';
  const savedCard = await fetch(`${address}/api/bots/echo`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      value: card.value,
      expectedRevision: card.revision,
    }),
  });
  assert.equal(savedCard.status, 200);
  assert.equal(
    (
      (await (await fetch(`${address}/api/bootstrap`)).json()) as {
        bots: { slug: string; name: string }[];
      }
    ).bots.find(({ slug }) => slug === 'echo')?.name,
    'Echo Updated',
  );
  assert.equal(
    (
      await fetch(`${address}/api/bots/echo`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          value: card.value,
          expectedRevision: card.revision,
        }),
      })
    ).status,
    409,
  );

  const preset = (await (
    await fetch(`${address}/api/presets/default`)
  ).json()) as {
    value: { context: { thresholdTokens: number } };
    revision: string;
  };
  assert.equal(preset.value.context.thresholdTokens, 10_000);
  assert.equal(
    (
      await fetch(`${address}/api/presets/default`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          value: preset.value,
          expectedRevision: preset.revision,
        }),
      })
    ).status,
    200,
  );

  const sessionId = await createSession(address);
  fixture.faux.setResponses([fauxAssistantMessage('A direct answer')]);
  await readEvents(
    await streamAttempt(address, sessionId, { kind: 'reply', text: 'Find me' }),
  );
  const titled = await fetch(`${address}/api/sessions/${sessionId}/title`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Golden conversation' }),
  });
  assert.equal(titled.status, 200);
  const bootstrap = (await (
    await fetch(`${address}/api/bootstrap`)
  ).json()) as {
    sessions: { title: string }[];
  };
  assert.deepEqual(
    bootstrap.sessions.map(({ title }) => title),
    ['Golden conversation'],
  );
  // The operator's one search reaches every session; the model's tools do not.
  const other = await createSession(address);
  fixture.faux.setResponses([fauxAssistantMessage('Another answer')]);
  await readEvents(
    await streamAttempt(address, other, { kind: 'reply', text: 'Find me too' }),
  );
  const global = (await (
    await fetch(`${address}/api/search?q=Find`)
  ).json()) as { results: { sessionId: string; snippet: string }[] };
  assert.deepEqual(
    new Set(global.results.map((result) => result.sessionId)),
    new Set([sessionId, other]),
  );
  // One snippet per session, marking the term the operator typed.
  assert.equal(global.results.length, 2);
  assert.ok(
    global.results.every((result) => result.snippet.includes('[Find]')),
  );
});
