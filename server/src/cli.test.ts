import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  readdir,
  writeFile,
  mkdir,
  rename,
  rm,
  chmod,
  stat,
  symlink,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';

import { AuthoredFiles } from './authored.js';
import { runCli, type CliIO } from './cli.js';
import { defaultRoot, initializeRoot, resolveRoot } from './root.js';
import { SCHEMA_VERSION } from './database.js';
import { createTestFixture, seedExchange } from './test-helper.js';

const DEFAULTS = resolve(import.meta.dirname, '../defaults');

async function disposableRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'simplebot-cli-'));
}

function recorder(answer = ''): CliIO & { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    lines,
    errors,
    out: (line) => lines.push(line),
    error: (line) => errors.push(line),
    confirm: async () => answer,
  };
}

test('the root is explicit configuration, then an existing root, then the OS location', async () => {
  const cwd = await disposableRoot();
  const explicit = await disposableRoot();
  assert.equal(resolveRoot({ SIMPLEBOT_ROOT: explicit }, cwd), explicit);
  // An empty variable is not a root; it falls through like an absent one.
  assert.equal(
    resolveRoot({ SIMPLEBOT_ROOT: '', XDG_DATA_HOME: '/x' }, cwd),
    defaultRoot({ XDG_DATA_HOME: '/x' }),
  );
  // An unrelated project's config.json must not attract SimpleBot data.
  await writeFile(join(cwd, 'config.json'), '{}');
  assert.equal(resolveRoot({}, cwd), defaultRoot({}));
  await mkdir(join(cwd, 'bots'), { recursive: true });
  await mkdir(join(cwd, 'presets'), { recursive: true });
  assert.equal(resolveRoot({}, cwd), cwd);
  assert.equal(
    resolveRoot({}, cwd, cwd),
    defaultRoot({}),
    'the package directory is never adopted as operator data',
  );
});

test('each OS keeps operator data in its own location', () => {
  assert.equal(
    defaultRoot({}, '/Users/x', 'darwin'),
    '/Users/x/Library/Application Support/SimpleBot',
  );
  assert.equal(
    defaultRoot(
      { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' },
      'C:\\Users\\x',
      'win32',
    ),
    join('C:\\Users\\x\\AppData\\Local', 'SimpleBot'),
  );
  assert.equal(
    defaultRoot({ XDG_DATA_HOME: '/data' }, '/home/x', 'linux'),
    '/data/simplebot',
  );
  assert.equal(
    defaultRoot({}, '/home/x', 'linux'),
    '/home/x/.local/share/simplebot',
  );
});

test('initialization seeds an absent root and never rewrites authored state', async () => {
  const root = await disposableRoot();
  const first = await initializeRoot(root, { defaults: DEFAULTS, tls: false });
  assert.deepEqual(first.findings, []);
  assert.equal(first.created.length, 3);
  for (const path of ['config.json', 'bots', 'presets/default.json'])
    assert.ok(existsSync(join(root, path)), path);
  assert.deepEqual(await readdir(join(root, 'bots')), []);

  await writeFile(join(root, 'presets/default.json'), '{"edited":true}');
  const second = await initializeRoot(root, { defaults: DEFAULTS, tls: false });
  assert.deepEqual(second.created, []);
  assert.equal(
    await readFile(join(root, 'presets/default.json'), 'utf8'),
    '{"edited":true}',
  );
});

test('initialization creates a private root and refuses exposed or symlink roots without changing them', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX permissions');
  const parent = await disposableRoot();
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, 'private');
  await initializeRoot(root, { tls: false });
  assert.equal((await stat(root)).mode & 0o777, 0o700);
  await chmod(root, 0o755);
  await assert.rejects(initializeRoot(root, { tls: false }), /0700/u);
  assert.equal((await stat(root)).mode & 0o777, 0o755);
  const alias = join(parent, 'alias');
  await symlink(root, alias);
  await assert.rejects(initializeRoot(alias, { tls: false }), /symlink/u);
});

test('unsafe listener configurations refuse before opening SQLite or activating MCP', async (t) => {
  const root = await disposableRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initializeRoot(root, { tls: false });
  const marker = join(root, 'activated');
  const config = await new AuthoredFiles(root).validateRequired();
  config.application.loginEnabled = false;
  config.mcpServers = {
    marker: {
      type: 'stdio',
      command: process.execPath,
      env: {},
      args: [
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bad')`,
      ],
    },
  };
  await writeFile(join(root, 'config.json'), JSON.stringify(config));
  for (const host of [
    '0.0.0.0',
    '::',
    '192.0.2.1',
    'localhost',
    '127.0.0.2',
    '::ffff:127.0.0.1',
    '0:0:0:0:0:0:0:1',
    '',
  ]) {
    const io = recorder();
    assert.equal(
      await runCli(['start'], io, {
        SIMPLEBOT_ROOT: root,
        SIMPLEBOT_HOST: host,
      }),
      1,
    );
    assert.match(io.errors.join('\n'), /Login-disabled mode requires/u);
    assert.equal(existsSync(marker), false);
    assert.equal(existsSync(join(root, 'data/app.db')), false);
  }
  config.application.loginEnabled = true;
  await writeFile(join(root, 'config.json'), JSON.stringify(config));
  const io = recorder();
  assert.equal(
    await runCli(['start'], io, {
      SIMPLEBOT_ROOT: root,
      SIMPLEBOT_HOST: '0.0.0.0',
    }),
    1,
  );
  assert.match(io.errors.join('\n'), /Remote access requires/u);
  assert.equal(existsSync(marker), false);
  assert.equal(existsSync(join(root, 'data/app.db')), false);
});

test('restart preserves renamed cards and removed defaults in existing collections', async (t) => {
  const root = await disposableRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initializeRoot(root, { defaults: DEFAULTS, tls: false });
  await new AuthoredFiles(root).createBot('Companion');
  await rename(
    join(root, 'bots/companion/companion.json'),
    join(root, 'bots/companion/renamed.json'),
  );
  await rm(join(root, 'presets/default.json'));
  const next = await initializeRoot(root, { defaults: DEFAULTS, tls: false });
  assert.deepEqual(next.created, []);
  assert.ok(existsSync(join(root, 'bots/companion/renamed.json')));
  assert.equal(existsSync(join(root, 'bots/companion/companion.json')), false);
  assert.deepEqual(await readdir(join(root, 'bots')), ['companion']);
  assert.equal(existsSync(join(root, 'presets/default.json')), false);
  assert.equal(resolveRoot({}, root), root);
});

test('init produces a complete root that doctor passes and pair works against', async () => {
  const root = await disposableRoot();
  const io = recorder();
  const code = await runCli(['init'], io, { SIMPLEBOT_ROOT: root });
  assert.equal(code, 0);
  assert.ok(io.lines[0]?.includes(root));

  const health = recorder();
  assert.equal(await runCli(['doctor'], health, { SIMPLEBOT_ROOT: root }), 0);

  // `init` then `pair` is the documented first run, so it has to work without
  // starting the server in between purely to bring the database into being.
  const paired = recorder();
  assert.equal(await runCli(['pair'], paired, { SIMPLEBOT_ROOT: root }), 0);
  assert.match(paired.lines.join('\n'), /Expires:/u);
});

test('init during a live reply preserves admission and the eventual provider answer', async (t) => {
  const fixture = await createTestFixture();
  const started = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  t.after(async () => {
    release.resolve(undefined);
    await fixture.runtime.close();
    await rm(fixture.root, { recursive: true, force: true });
  });
  fixture.faux.setResponses([
    async () => {
      started.resolve(undefined);
      await release.promise;
      return fauxAssistantMessage('The live answer survived initialization.');
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
    command: { kind: 'reply', text: 'Keep this admitted reply.' },
    emit: () => undefined,
  });
  await started.promise;
  const answer = () => {
    const last = fixture.runtime.storage
      .projection(sessionId)
      .page.positions.at(-1);
    assert.ok(last?.role === 'assistant');
    return last.variant.source;
  };
  assert.equal(answer(), '');
  assert.equal(
    await runCli(['init'], recorder(), { SIMPLEBOT_ROOT: fixture.root }),
    0,
  );
  assert.equal(answer(), '');
  release.resolve(undefined);
  await attempt.done;
  assert.equal(answer(), 'The live answer survived initialization.');
});

test('init preserves accepted effects and pending compaction for runtime startup to complete', async (t) => {
  const fixture = await createTestFixture();
  t.after(async () => {
    await fixture.runtime.close();
    await rm(fixture.root, { recursive: true, force: true });
  });
  const { storage } = fixture.runtime;
  const sessionId = randomUUID();
  const now = new Date().toISOString();
  storage.createSession({
    id: sessionId,
    botSlug: 'echo',
    presetSlug: 'default',
    now,
  });
  seedExchange(fixture, {
    sessionId,
    now,
    user: 'First exchange',
    assistant: 'First answer',
    lock: true,
    effects: [
      { type: 'variable_set', arguments: { name: 'venue', value: 'Library' } },
    ],
  });
  seedExchange(fixture, {
    sessionId,
    now,
    user: 'Live tail',
    assistant: 'Tail answer',
  });
  assert.ok(
    storage.createPendingLeaf({ sessionId, liveTailExchanges: 1, now }),
  );
  const before = storage.connection.serialize();
  assert.equal(
    await runCli(['init'], recorder(), { SIMPLEBOT_ROOT: fixture.root }),
    0,
  );
  assert.deepEqual(storage.connection.serialize(), before);
  assert.equal(storage.sessionVariables(sessionId).venue, undefined);
});

for (const mismatch of ['older', 'newer', 'table'] as const) {
  test(`doctor refuses ${mismatch} schema mismatches without modifying the database`, async (t) => {
    const fixture = await createTestFixture();
    t.after(async () => {
      await fixture.runtime.close();
      await rm(fixture.root, { recursive: true, force: true });
    });
    const database = fixture.runtime.storage.connection;
    if (mismatch === 'table') database.exec('DROP TABLE schedules');
    else
      database.pragma(
        `user_version = ${String(SCHEMA_VERSION + (mismatch === 'older' ? -1 : 1))}`,
      );
    const before = database.serialize();
    const io = recorder();
    assert.equal(
      await runCli(['doctor'], io, { SIMPLEBOT_ROOT: fixture.root }),
      1,
    );
    assert.match(io.lines.join('\n'), /does not match schema/u);
    assert.deepEqual(database.serialize(), before);
  });
}

test('doctor reports mismatched and expired TLS certificates without rewriting them', async (t) => {
  const root = await disposableRoot();
  const other = await disposableRoot();
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(other, { recursive: true, force: true });
  });
  assert.equal(await runCli(['init'], recorder(), { SIMPLEBOT_ROOT: root }), 0);
  await initializeRoot(other);
  const original = await readFile(join(root, 'data/tls/cert.pem'));
  await writeFile(
    join(root, 'data/tls/cert.pem'),
    await readFile(join(other, 'data/tls/cert.pem')),
  );
  const mismatch = recorder();
  assert.equal(await runCli(['doctor'], mismatch, { SIMPLEBOT_ROOT: root }), 1);
  assert.match(mismatch.lines.join('\n'), /does not match/u);
  await writeFile(join(root, 'data/tls/cert.pem'), original);
  t.mock.method(Date, 'now', () => Date.UTC(2100, 0, 1));
  const expired = recorder();
  assert.equal(await runCli(['doctor'], expired, { SIMPLEBOT_ROOT: root }), 1);
  assert.match(expired.lines.join('\n'), /validity period/u);
  assert.deepEqual(await readFile(join(root, 'data/tls/cert.pem')), original);
});

test('a command against an uninitialized root names init rather than the driver error', async () => {
  const io = recorder();
  const code = await runCli(['pair'], io, {
    SIMPLEBOT_ROOT: join(tmpdir(), `simplebot-absent-${randomUUID()}`),
  });
  assert.equal(code, 1);
  assert.match(io.errors.join('\n'), /Run `simplebot init` first/u);
});

test('version and help answer without touching the root', async () => {
  const io = recorder();
  assert.equal(
    await runCli(['version'], io, { SIMPLEBOT_ROOT: '/nonexistent' }),
    0,
  );
  assert.match(io.lines[0] ?? '', /^\d+\.\d+\.\d+(?:-[\w.]+)?$/u);
  const help = recorder();
  assert.equal(
    await runCli(['help'], help, { SIMPLEBOT_ROOT: '/nonexistent' }),
    0,
  );
  assert.match(help.lines[0] ?? '', /Usage: simplebot/u);
});

test('an unknown command fails with the usage text instead of acting', async () => {
  const io = recorder();
  assert.equal(
    await runCli(['wat'], io, { SIMPLEBOT_ROOT: '/nonexistent' }),
    2,
  );
  assert.match(io.errors.join('\n'), /Unknown command: wat/u);
});

test('data removal requires the exact root and removes nothing otherwise', async () => {
  const root = await disposableRoot();
  await mkdir(join(root, 'bots'), { recursive: true });
  await writeFile(join(root, 'config.json'), '{}');

  const refused = recorder('yes');
  assert.equal(
    await runCli(['remove-data'], refused, { SIMPLEBOT_ROOT: root }),
    1,
  );
  assert.ok(existsSync(join(root, 'config.json')));
  assert.match(refused.errors.join('\n'), /Nothing was removed/u);

  const confirmed = recorder(root);
  assert.equal(
    await runCli(['remove-data'], confirmed, { SIMPLEBOT_ROOT: root }),
    0,
  );
  assert.equal(existsSync(root), false);
});
