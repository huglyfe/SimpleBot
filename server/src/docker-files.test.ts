import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import {
  FILE_BYTES,
  quoteShell,
  runFileTool,
  type FileExec,
} from './docker-files.js';
import { activateDocker } from './docker.js';
import { ActivatedCapabilities } from './capabilities.js';
import { McpResources } from './mcp.js';
import { randomUUID } from 'node:crypto';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import {
  createTestFixture,
  disposeTestFixture,
  writeBotSettings,
} from './test-helper.js';
import { AuthoredFiles } from './authored.js';
import { AttemptManager } from './attempts.js';

const reply = (stdout: string | Buffer, code = 0, stderr = '') => ({
  stdout: Buffer.from(stdout),
  stderr: Buffer.from(stderr),
  code,
});

test('file reads paginate UTF-8, preserve BOM, and refuse binary, oversized, or invalid paths', async () => {
  const run: FileExec = async () => reply('one\ntwo\nthree\n');
  assert.equal(
    await runFileTool(
      'read_file',
      { path: '/notes', offset: 2, limit: 1 },
      run,
    ),
    '2: two\n[More lines; continue at offset 3.]',
  );
  assert.equal(
    await runFileTool('read_file', { path: '/notes', offset: 8 }, run),
    'No lines at this offset.',
  );
  assert.equal(
    await runFileTool('read_file', { path: '/notes' }, async () =>
      reply('\ufeffone'),
    ),
    '1: \ufeffone',
  );
  await assert.rejects(
    runFileTool('read_file', { path: '/notes' }, async () =>
      reply(Buffer.from([0xff])),
    ),
    /UTF-8/u,
  );
  await assert.rejects(
    runFileTool('read_file', { path: '/notes' }, async () => reply('a\0b')),
    /UTF-8/u,
  );
  await assert.rejects(
    runFileTool('read_file', { path: '/notes' }, async () =>
      reply('a'.repeat(FILE_BYTES + 1)),
    ),
    /1 MiB/u,
  );
  await assert.rejects(runFileTool('read_file', { path: '../host' }, run));
});

test('edits require one exact match and send literal replacement content over stdin with a changed-file guard', async () => {
  const scripts: string[] = [];
  const inputs: (string | undefined)[] = [];
  const run: FileExec = async (script, input) => {
    scripts.push(script);
    inputs.push(input);
    return reply(input === undefined ? 'hello\r\nworld\r\n' : '');
  };
  const path = "/work/a '$(touch injected)' file";
  assert.equal(
    await runFileTool(
      'edit_file',
      { path, old_text: 'hello', new_text: '$(literal) `literal`' },
      run,
    ),
    `Updated ${path} (1 replacement).`,
  );
  assert.equal(inputs[1], '$(literal) `literal`\r\nworld\r\n');
  assert.ok(!scripts[1]?.includes('$(literal)'));
  assert.match(scripts[1] ?? '', /sha256sum/u);
  assert.match(scripts[1] ?? '', /mv -fT/u);
  assert.ok(scripts[0]?.includes(quoteShell(path)));
  let writes = 0;
  const repeated: FileExec = async (_script, input) => {
    if (input !== undefined) writes++;
    return reply('abc abc');
  };
  assert.match(
    await runFileTool(
      'edit_file',
      { path: '/a', old_text: 'abc', new_text: 'x' },
      repeated,
    ),
    /multiple locations/u,
  );
  assert.match(
    await runFileTool(
      'edit_file',
      { path: '/a', old_text: 'missing', new_text: 'x' },
      repeated,
    ),
    /not found/u,
  );
  assert.equal(writes, 0);
  await assert.rejects(
    runFileTool('write_file', { path: '/a', content: 'hello' }, async () =>
      reply('', 1, 'Read-only file system'),
    ),
    /Read-only/u,
  );
});

test('search preserves ripgrep failures, empty matches, and truncation as distinct results', async () => {
  assert.equal(
    await runFileTool('search_files', { path: '/a', pattern: 'x' }, async () =>
      reply('', 1),
    ),
    'No matches.',
  );
  await assert.rejects(
    runFileTool('search_files', { path: '/a', pattern: '[' }, async () =>
      reply('', 2, 'regex parse error'),
    ),
    /regex parse/u,
  );
  assert.equal(
    await runFileTool(
      'search_files',
      { path: '/a', pattern: '*', target: 'files', limit: 1 },
      async (script) => {
        assert.match(script, /rg --files/u);
        return reply('/a/one\n/a/two\n');
      },
    ),
    '/a/one\n[Results truncated; narrow the search.]',
  );
});

test('Docker file transport uses immutable IDs, stdin, bounded failures and separate grants without terminal', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'simplebot-files-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = join(root, 'docker');
  const log = join(root, 'calls');
  const body = join(root, 'body');
  await writeFile(
    executable,
    `#!/bin/sh
printf '%s\\n' "$*" >> ${quoteShell(log)}
case "$2" in
inspect) printf '%064d\\trunning\\n' 7 ;;
exec) cat > ${quoteShell(body)} ;;
esac
`,
  );
  await chmod(executable, 0o700);
  const docker = await activateDocker(
    { workspace: 'configured-name' },
    executable,
  );
  t.after(() => docker.close());
  const tools = docker.fileTools();
  assert.equal(tools.length, 4);
  assert.ok(tools.every((tool) => tool.available));
  const resources = new ActivatedCapabilities(
    {
      dependencies: [],
      capabilities: tools.map(({ name, description, available }) => ({
        kind: 'tool',
        name,
        description,
        available,
      })),
    },
    [],
    new McpResources([], []),
    docker,
  );
  assert.deepEqual(resources.select([]).toolNames, []);
  const selected = resources.select([
    { kind: 'tool', name: 'docker__workspace__write_file' },
  ]);
  assert.deepEqual(selected.toolNames, ['docker__workspace__write_file']);
  assert.equal(selected.terminal, null);
  const limits = { timeoutMs: 1000, maxOutputChars: 12000 };
  await resources.callFile(
    'docker__workspace__write_file',
    { path: '/a', content: 'literal $(data)' },
    limits,
    new AbortController().signal,
  );
  assert.equal(await readFile(body, 'utf8'), 'literal $(data)');
  const calls = await readFile(log, 'utf8');
  assert.ok(!calls.includes('literal $(data)'));
  assert.match(calls, /container exec -i 0{63}7 sh -c/u);
  const fixture = await createTestFixture();
  t.after(() => disposeTestFixture(fixture));
  await writeBotSettings(fixture.root, {
    capabilities: [{ kind: 'tool', name: 'docker__workspace__write_file' }],
  });
  const manager = new AttemptManager({
    storage: fixture.runtime.storage,
    authored: new AuthoredFiles(fixture.root),
    capabilities: () => resources,
    models: fixture.models,
    schedulesChanged: () => undefined,
    applyMemoryRetention: async () => {
      throw new Error('File writes must not become effects');
    },
  });
  t.after(() => manager.close());
  const sessionId = randomUUID();
  fixture.runtime.storage.createSession({
    id: sessionId,
    botSlug: 'echo',
    presetSlug: 'default',
    now: new Date().toISOString(),
  });
  fixture.faux.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall('docker__workspace__write_file', {
          path: '/a',
          content: 'persisted before acceptance',
        }),
      ],
      { stopReason: 'toolUse' },
    ),
    (context) => {
      assert.match(JSON.stringify(context.messages), /Wrote \/a/u);
      return fauxAssistantMessage('', {
        stopReason: 'error',
        errorMessage: 'Synthetic model failure',
      });
    },
    fauxAssistantMessage('A different swipe.'),
  ]);
  await manager.enqueue({
    sessionId,
    command: { kind: 'reply', text: 'Write a file.' },
    emit: () => undefined,
  }).done;
  const position = fixture.runtime.storage
    .transcriptPage(sessionId, null)
    .positions.at(-1);
  assert.ok(position?.role === 'assistant');
  assert.deepEqual(position.variant.effects, []);
  assert.match(position.variant.source, /Synthetic model failure/u);
  assert.match(
    JSON.stringify(position.variant.trace),
    /docker__workspace__write_file/u,
  );
  assert.equal(await readFile(body, 'utf8'), 'persisted before acceptance');
  await manager.enqueue({
    sessionId,
    command: { kind: 'swipe', positionId: position.id },
    emit: () => undefined,
  }).done;
  assert.equal(await readFile(body, 'utf8'), 'persisted before acceptance');
  await assert.rejects(
    resources.callFile(
      'docker__other__read_file',
      { path: '/a' },
      limits,
      new AbortController().signal,
    ),
    /unavailable/u,
  );
  await resources.close();
  await assert.rejects(
    resources.callFile(
      'docker__workspace__read_file',
      { path: '/a' },
      limits,
      new AbortController().signal,
    ),
    /unavailable/u,
  );
});

test('missing Unix prerequisites disable file tools without disabling terminal or retrying', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'simplebot-files-missing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = join(root, 'docker');
  await writeFile(
    executable,
    "#!/bin/sh\ncase \"$2\" in\ninspect) printf '%064d\\trunning\\n' 1 ;;\nexec) printf 'Missing filesystem command: rg'; exit 1 ;;\nesac\n",
  );
  await chmod(executable, 0o700);
  const docker = await activateDocker({ workspace: 'test' }, executable);
  t.after(() => docker.close());
  assert.equal(docker.statuses[0]?.available, true);
  assert.ok(docker.fileTools().every((tool) => !tool.available));
  assert.match(docker.statuses[0].filesError ?? '', /rg/u);
});

// Explicit opt-in: the named container must be disposable, with GNU tools and rg.
test(
  'real Docker filesystem tools round-trip literal text and reject ambiguous edits',
  { skip: !process.env.SIMPLEBOT_DOCKER_TEST_CONTAINER },
  async (t) => {
    const container = process.env.SIMPLEBOT_DOCKER_TEST_CONTAINER;
    assert.ok(container);
    const docker = await activateDocker({ test: container });
    let directory: string | undefined;
    const shell = promisify(execFile);
    t.after(async () => {
      try {
        if (directory !== undefined)
          await shell('docker', [
            'exec',
            container,
            'rm',
            '-rf',
            '--',
            directory,
          ]);
      } finally {
        await docker.close();
      }
    });
    assert.ok(docker.fileTools().every((tool) => tool.available));
    const { stdout } = await shell('docker', [
      'exec',
      container,
      'mktemp',
      '-d',
    ]);
    directory = stdout.trim();
    const path = `${directory}/a 'quoted' file.txt`;
    const call = (name: string, args: Record<string, unknown>) =>
      docker.callFile(
        `docker__test__${name}`,
        args,
        { timeoutMs: 5000, maxOutputChars: 12000 },
        new AbortController().signal,
      );
    await call('write_file', { path, content: 'hello\nhello\n$(literal)\n' });
    assert.match(await call('read_file', { path }), /3: \$\(literal\)/u);
    assert.match(
      await call('edit_file', { path, old_text: 'hello', new_text: 'bad' }),
      /multiple locations/u,
    );
    await call('edit_file', {
      path,
      old_text: '$(literal)',
      new_text: 'updated',
    });
    assert.match(
      await call('search_files', { path: directory, pattern: 'updated' }),
      /:3:updated/u,
    );
  },
);
