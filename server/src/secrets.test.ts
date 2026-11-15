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
import { fileURLToPath } from 'node:url';
import { settingsDocumentSchema } from '@simplebot/shared';
import { AuthoredFiles } from './authored.js';
import { providerConnection } from './credentials.js';
import { activateMcp } from './mcp.js';
import { createBackup, restoreBackup } from './operations.js';
import { PrivateValues } from './secrets.js';
import {
  createTestFixture,
  disposeTestFixture,
  reopenTestFixture,
} from './test-helper.js';

async function privateFile(root: string): Promise<Record<string, string>> {
  return JSON.parse(
    await readFile(join(root, 'secrets.json'), 'utf8'),
  ) as Record<string, string>;
}

test('private values are write-only through settings, overwritable, and survive restart', async (t) => {
  const fixture = await createTestFixture();
  t.after(() => disposeTestFixture(fixture));
  const save = async (apiKey: unknown) => {
    const current = settingsDocumentSchema.parse(
      (await fixture.runtime.app.inject('/api/settings')).json(),
    );
    const response = await fixture.runtime.app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: {
        value: {
          ...current.value,
          providers: { ...current.value.providers, synthetic: { apiKey } },
        },
        expectedRevision: current.revision,
      },
    });
    assert.equal(response.statusCode, 200);
    assert.ok(!response.body.includes('synthetic-key'));
  };
  const savedKey = async () => {
    const { value } = await new AuthoredFiles(fixture.root).readConfig();
    const provider = value.providers.synthetic;
    assert.ok(provider !== undefined);
    return providerConnection(provider, 'synthetic', fixture.root).apiKey;
  };

  await save({ value: 'synthetic-key-one' });
  assert.equal(await savedKey(), 'synthetic-key-one');
  assert.equal(
    (await stat(join(fixture.root, 'secrets.json'))).mode & 0o777,
    0o600,
  );
  const config = await readFile(join(fixture.root, 'config.json'), 'utf8');
  assert.ok(!config.includes('synthetic-key'));
  const stored = (
    JSON.parse(config) as { providers: { synthetic: { apiKey: unknown } } }
  ).providers.synthetic.apiKey;
  assert.match(JSON.stringify(stored), /^\{"private":"[a-f0-9]{32}"\}$/u);
  for (const url of ['/api/settings', '/api/dependencies', '/api/capabilities'])
    assert.ok(
      !(await fixture.runtime.app.inject(url)).body.includes('synthetic-key'),
    );

  // Saving the reference back keeps the value; a new value overwrites it.
  await save(stored);
  assert.equal(await savedKey(), 'synthetic-key-one');
  await save({ value: 'synthetic-key-two' });
  assert.equal(await savedKey(), 'synthetic-key-two');
  // The superseded value is pruned once no saved config references it.
  await save(
    (await new AuthoredFiles(fixture.root).readConfig()).value.providers
      .synthetic?.apiKey,
  );
  assert.deepEqual(Object.values(await privateFile(fixture.root)), [
    'synthetic-key-two',
  ]);

  await fixture.runtime.close();
  fixture.runtime = (await reopenTestFixture(fixture)).runtime;
  assert.equal(await savedKey(), 'synthetic-key-two');

  // Switching to an environment reference drops the private value.
  await save('${SYNTHETIC_KEY}');
  await save('${SYNTHETIC_KEY}');
  assert.deepEqual(await privateFile(fixture.root), {});
});

test('config.json never carries a plaintext private value', async (t) => {
  const fixture = await createTestFixture();
  t.after(() => disposeTestFixture(fixture));
  const path = join(fixture.root, 'config.json');
  const config = JSON.parse(await readFile(path, 'utf8')) as {
    providers: Record<string, unknown>;
  };
  config.providers.synthetic = { apiKey: { value: 'hand-written-key' } };
  await writeFile(path, JSON.stringify(config));
  await assert.rejects(
    new AuthoredFiles(fixture.root).readConfig(),
    /private values must be entered in settings/u,
  );
});

test('private storage rejects broad permissions, symlinks, and malformed files without revealing contents', async (t) => {
  const fixture = await createTestFixture();
  t.after(() => disposeTestFixture(fixture));
  const values = new PrivateValues(fixture.root);
  const id = 'a'.repeat(32);
  const path = join(fixture.root, 'secrets.json');
  await writeFile(path, JSON.stringify({ [id]: 'private-test' }), {
    mode: 0o644,
  });
  assert.throws(() => values.resolve(id), /not private/u);
  await chmod(path, 0o600);
  assert.equal(values.resolve(id), 'private-test');
  await writeFile(path, 'malformed-private-test');
  try {
    values.resolve(id);
    assert.fail('must fail');
  } catch (error) {
    assert.ok(!String(error).includes('malformed-private-test'));
  }
  await unlink(path);
  await symlink(join(fixture.root, 'config.json'), path);
  assert.throws(() => values.resolve(id), /unreadable/u);
});

test('backups exclude private values and restored references require re-entry', async (t) => {
  const fixture = await createTestFixture();
  t.after(() => disposeTestFixture(fixture));
  const authored = new AuthoredFiles(fixture.root);
  const config = await authored.readConfig();
  await authored.writeConfig(
    {
      ...config.value,
      providers: {
        ...config.value.providers,
        synthetic: { apiKey: { value: 'synthetic-backup-secret' } },
      },
    },
    config.revision,
  );
  const backup = join(fixture.root, 'backup');
  const manifest = await createBackup(
    fixture.root,
    backup,
    fixture.runtime.storage,
  );
  assert.ok(
    manifest.external.includes('private values (re-enter after restore)'),
  );
  await assert.rejects(readFile(join(backup, 'payload', 'secrets.json')));
  const restored = join(fixture.root, 'restored');
  await restoreBackup(backup, restored);
  const provider = (await new AuthoredFiles(restored).readConfig()).value
    .providers.synthetic;
  assert.ok(provider !== undefined);
  assert.throws(
    () => providerConnection(provider, 'synthetic', restored),
    /private value is not set; enter it again/u,
  );
});

test('MCP plain and private values stay fixed on the open connection until explicit reactivation', async (t) => {
  const fixture = await createTestFixture();
  t.after(() => disposeTestFixture(fixture));
  const authored = new AuthoredFiles(fixture.root);
  const firstPath = join(fixture.root, 'first-notes');
  const secondPath = join(fixture.root, 'second-notes');
  const saveNotes = async (env: Record<string, unknown>) => {
    const current = await authored.readDependencyConfig();
    await authored.writeDependencyConfig(
      {
        ...current.value,
        mcpServers: {
          notes: {
            type: 'stdio',
            command: process.execPath,
            args: [
              '--import',
              import.meta.resolve('tsx'),
              fileURLToPath(new URL('../test/mcp-server.ts', import.meta.url)),
            ],
            env,
          },
        },
      },
      current.revision,
    );
    return (await authored.readDependencyConfig()).value.mcpServers;
  };
  const plain = await saveNotes({ FIXTURE_PATH: firstPath });
  const first = await activateMcp(plain, fixture.root);
  t.after(() => first.close());
  assert.equal(first.statuses[0]?.available, true);
  const secret = await saveNotes({ FIXTURE_PATH: { value: secondPath } });
  await first.call(
    'mcp__notes__write_note',
    { text: 'old connection' },
    new AbortController().signal,
  );
  assert.equal(await readFile(firstPath, 'utf8'), 'old connection\n');
  await assert.rejects(readFile(secondPath));
  const next = await activateMcp(secret, fixture.root);
  t.after(() => next.close());
  await next.call(
    'mcp__notes__write_note',
    { text: 'new connection' },
    new AbortController().signal,
  );
  assert.equal(await readFile(secondPath, 'utf8'), 'new connection\n');
  assert.ok(!JSON.stringify(next.statuses).includes(secondPath));
  assert.ok(!JSON.stringify(secret).includes(secondPath));
});
