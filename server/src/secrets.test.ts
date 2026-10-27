import assert from 'node:assert/strict';
import {
  chmod,
  readFile,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { secretListSchema } from '@simplebot/shared';
import { SecretStore } from './secrets.js';
import { resolveCredential } from './credentials.js';
import { createBackup, restoreBackup } from './operations.js';
import {
  createTestFixture,
  disposeTestFixture,
  reopenTestFixture,
} from './test-helper.js';
import { AuthoredFiles } from './authored.js';
import { activateMcp } from './mcp.js';
import { fileURLToPath } from 'node:url';

test('secret API keeps values private, rejects stale writes and in-use removal, and survives restart', async (t) => {
  const fixture = await createTestFixture();
  t.after(() => disposeTestFixture(fixture));
  const app = fixture.runtime.app;
  const initial = secretListSchema.parse(
    (await app.inject('/api/secrets')).json(),
  );
  const invalidName = await app.inject({
    method: 'PUT',
    url: '/api/secrets/__proto__',
    payload: {
      value: 'must-not-disappear',
      expectedRevision: initial.revision,
    },
  });
  assert.equal(invalidName.statusCode, 400);
  assert.deepEqual(
    secretListSchema.parse((await app.inject('/api/secrets')).json()),
    initial,
  );
  const saved = await app.inject({
    method: 'PUT',
    url: '/api/secrets/TEST_KEY',
    payload: {
      value: 'synthetic-secret-one',
      expectedRevision: initial.revision,
    },
  });
  assert.equal(saved.statusCode, 200);
  assert.ok(!saved.body.includes('synthetic-secret-one'));
  const metadata = secretListSchema.parse(saved.json());
  assert.deepEqual(metadata.names, ['TEST_KEY']);
  assert.equal(
    (await stat(join(fixture.root, 'secrets.json'))).mode & 0o777,
    0o600,
  );
  assert.equal(
    resolveCredential('secret:TEST_KEY', 'Test', {}, fixture.root),
    'synthetic-secret-one',
  );
  assert.throws(
    () =>
      resolveCredential(
        'secret:MISSING',
        'Test',
        { MISSING: 'ambient' },
        fixture.root,
      ),
    /unavailable/u,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/secrets/TEST_KEY',
        payload: { value: 'stale-secret', expectedRevision: initial.revision },
      })
    ).statusCode,
    409,
  );
  const authored = new AuthoredFiles(fixture.root);
  const config = await authored.readConfig();
  await authored.writeConfig(
    {
      ...config.value,
      providers: {
        ...config.value.providers,
        synthetic: { apiKey: 'secret:TEST_KEY' },
      },
    },
    config.revision,
  );
  assert.equal(
    (
      await app.inject({
        method: 'DELETE',
        url: '/api/secrets/TEST_KEY',
        payload: { expectedRevision: metadata.revision },
      })
    ).statusCode,
    409,
  );
  const replaced = secretListSchema.parse(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/secrets/TEST_KEY',
        payload: {
          value: 'synthetic-secret-two',
          expectedRevision: metadata.revision,
        },
      })
    ).json(),
  );
  assert.equal(
    new SecretStore(fixture.root).resolve('TEST_KEY'),
    'synthetic-secret-two',
  );
  for (const url of [
    '/api/secrets',
    '/api/settings',
    '/api/dependencies',
    '/api/capabilities',
  ]) {
    assert.ok(!(await app.inject(url)).body.includes('synthetic-secret-two'));
  }
  await fixture.runtime.close();
  fixture.runtime = (await reopenTestFixture(fixture)).runtime;
  assert.deepEqual(
    secretListSchema.parse(
      (await fixture.runtime.app.inject('/api/secrets')).json(),
    ),
    replaced,
  );
  const latest = await authored.readConfig();
  await authored.writeConfig(config.value, latest.revision);
  const removed = await fixture.runtime.app.inject({
    method: 'DELETE',
    url: '/api/secrets/TEST_KEY',
    payload: { expectedRevision: replaced.revision },
  });
  assert.equal(removed.statusCode, 200);
  assert.deepEqual(secretListSchema.parse(removed.json()).names, []);
});

test('secrets obey pairing and reject symlinks, broad permissions, and malformed files without revealing contents', async (t) => {
  const fixture = await createTestFixture({ loginEnabled: true });
  t.after(() => disposeTestFixture(fixture));
  for (const method of ['GET', 'PUT', 'DELETE'] as const) {
    const response = await fixture.runtime.app.inject({
      method,
      url: method === 'GET' ? '/api/secrets' : '/api/secrets/KEY',
      ...(method === 'GET'
        ? {}
        : { payload: { value: 'private-test', expectedRevision: '' } }),
    });
    assert.equal(response.statusCode, 401);
  }
  const store = new SecretStore(fixture.root);
  const path = join(fixture.root, 'secrets.json');
  await writeFile(path, '{"KEY":"private-test"}', { mode: 0o644 });
  assert.throws(() => store.list(), /not private/u);
  await chmod(path, 0o600);
  await writeFile(path, 'malformed-private-test');
  try {
    store.list();
    assert.fail('must fail');
  } catch (error) {
    assert.ok(!String(error).includes('malformed-private-test'));
  }
  await unlink(path);
  await symlink(join(fixture.root, 'config.json'), path);
  assert.throws(() => store.list(), /unreadable/u);
});

test('backups explicitly exclude saved secrets and restored references require re-entry', async (t) => {
  const fixture = await createTestFixture();
  t.after(() => disposeTestFixture(fixture));
  const store = new SecretStore(fixture.root);
  store.write('BACKUP_KEY', 'synthetic-backup-secret', store.list().revision);
  const backup = join(fixture.root, 'backup');
  const manifest = await createBackup(
    fixture.root,
    backup,
    fixture.runtime.storage,
  );
  assert.ok(
    manifest.external.includes('saved secrets (re-enter after restore)'),
  );
  assert.ok(
    !(await readFile(join(backup, 'manifest.json'), 'utf8')).includes(
      'synthetic-backup-secret',
    ),
  );
  await assert.rejects(readFile(join(backup, 'payload', 'secrets.json')));
  const restored = join(fixture.root, 'restored');
  await restoreBackup(backup, restored);
  assert.deepEqual(new SecretStore(restored).list().names, []);
});

test('MCP saved credentials stay fixed on the open connection until explicit reactivation', async (t) => {
  const fixture = await createTestFixture();
  t.after(() => disposeTestFixture(fixture));
  const secrets = new SecretStore(fixture.root);
  const firstPath = join(fixture.root, 'first-notes');
  const secondPath = join(fixture.root, 'second-notes');
  secrets.write('MCP_PATH', firstPath, secrets.list().revision);
  const definitions = {
    notes: {
      type: 'stdio' as const,
      command: process.execPath,
      args: [
        '--import',
        import.meta.resolve('tsx'),
        fileURLToPath(new URL('../test/mcp-server.ts', import.meta.url)),
      ],
      env: { FIXTURE_PATH: 'secret:MCP_PATH' },
    },
  };
  const first = await activateMcp(definitions, fixture.root);
  t.after(() => first.close());
  assert.equal(first.statuses[0]?.available, true);
  secrets.write('MCP_PATH', secondPath, secrets.list().revision);
  await first.call(
    'mcp__notes__write_note',
    { text: 'old connection' },
    new AbortController().signal,
  );
  assert.equal(await readFile(firstPath, 'utf8'), 'old connection\n');
  await assert.rejects(readFile(secondPath));
  const next = await activateMcp(definitions, fixture.root);
  t.after(() => next.close());
  await next.call(
    'mcp__notes__write_note',
    { text: 'new connection' },
    new AbortController().signal,
  );
  assert.equal(await readFile(secondPath, 'utf8'), 'new connection\n');
  assert.ok(!JSON.stringify(next.statuses).includes(secondPath));
});
