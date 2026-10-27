import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { AuthoredFiles } from './authored.js';
import { initializeRoot, SCHEMA } from './root.js';
import { createRuntime } from './runtime.js';

test('a failed CLI listen closes activated MCP resources and exits with failure', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'simplebot-listen-failure-'));
  const listener = createServer();
  let spawned: ReturnType<typeof spawn> | undefined;
  t.after(async () => {
    if (spawned?.exitCode === null) {
      const exited = once(spawned, 'exit');
      spawned.kill('SIGTERM');
      await exited;
    }
    if (listener.listening)
      await new Promise<void>((accept) => listener.close(() => accept()));
    await rm(root, { recursive: true, force: true });
  });
  await initializeRoot(root);
  const started = join(root, 'mcp-started');
  const closed = join(root, 'mcp-closed');
  const wrapper = join(root, 'mcp.mjs');
  await writeFile(
    wrapper,
    `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(started)}, 'started');
process.once('exit', () => writeFileSync(${JSON.stringify(closed)}, 'closed'));
await import(${JSON.stringify(pathToFileURL(resolve(import.meta.dirname, '../test/mcp-server.ts')).href)});
`,
  );
  const config = await new AuthoredFiles(root).validateRequired();
  config.application.loginEnabled = false;
  config.mcpServers = {
    fixture: {
      type: 'stdio',
      command: process.execPath,
      args: ['--import', import.meta.resolve('tsx'), wrapper],
      env: {},
    },
  };
  await writeFile(join(root, 'config.json'), JSON.stringify(config));
  await new Promise<void>((accept, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', accept);
  });
  const address = listener.address();
  assert.ok(address !== null && typeof address !== 'string');
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      "import { runCli } from './server/src/cli.ts'; process.exitCode = await runCli(['start']);",
    ],
    {
      cwd: resolve(import.meta.dirname, '../..'),
      env: {
        ...process.env,
        SIMPLEBOT_ROOT: root,
        SIMPLEBOT_HOST: '127.0.0.1',
        SIMPLEBOT_PORT: String(address.port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  spawned = child;
  let errors = '';
  child.stderr.on('data', (chunk: Buffer) => {
    errors += chunk.toString();
  });
  const exitCode = await new Promise<number | null>((accept, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Failed startup stayed alive: ${errors}`)),
      10_000,
    );
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      accept(code);
    });
  });
  assert.equal(exitCode, 1);
  assert.match(errors, /EADDRINUSE/u);
  assert.equal(await readFile(started, 'utf8'), 'started');
  assert.equal(await readFile(closed, 'utf8'), 'closed');
});

for (const host of ['127.0.0.1', '::1', '0.0.0.0']) {
  test(`CLI starts a legitimate ${host} listener with its intended authentication`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'simplebot-start-'));
    const remote = host === '0.0.0.0';
    await initializeRoot(root);
    const file = join(root, 'config.json');
    const config = await new AuthoredFiles(root).validateRequired();
    config.application.loginEnabled = remote;
    await writeFile(file, JSON.stringify(config));
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        "import { runCli } from './server/src/cli.ts'; process.exitCode = await runCli(['start']);",
      ],
      {
        cwd: resolve(import.meta.dirname, '../..'),
        env: {
          ...process.env,
          SIMPLEBOT_ROOT: root,
          SIMPLEBOT_HOST: host,
          SIMPLEBOT_PORT: '0',
          ...(remote
            ? {
                SIMPLEBOT_TLS_KEY: join(root, 'data/tls/key.pem'),
                SIMPLEBOT_TLS_CERT: join(root, 'data/tls/cert.pem'),
              }
            : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    t.after(async () => {
      if (child.exitCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        await exited;
      }
      await rm(root, { recursive: true, force: true });
    });
    // Port 0 is resolved by Fastify; inspect the captured process's stdout.
    let output = '';
    let errors = '';
    child.stderr.on('data', (chunk: Buffer) => {
      errors += chunk.toString();
    });
    await new Promise<void>((accept, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Startup timed out: ${errors}`)),
        10_000,
      );
      child.once('exit', () => {
        clearTimeout(timer);
        reject(new Error(errors || output));
      });
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes('Root:')) {
          clearTimeout(timer);
          accept();
        }
      });
    });
    const address = /on (https?:\/\/\S+)/u.exec(output)?.[1];
    assert.ok(address);
    const url = new URL(address.replace('0.0.0.0', '127.0.0.1'));
    url.pathname = '/api/bootstrap';
    const status = remote
      ? await new Promise<number | undefined>((accept, reject) => {
          // Only this disposable self-signed test listener bypasses CA validation.
          const req = request(
            url,
            { rejectUnauthorized: false },
            (response) => {
              response.resume();
              accept(response.statusCode);
            },
          );
          req.on('error', reject);
          req.end();
        })
      : (await fetch(url)).status;
    assert.equal(status, remote ? 401 : 200);
  });
}

test('runtime authentication uses the validated startup snapshot even if the file changes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'simplebot-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await initializeRoot(root, { tls: false });
  const config = await new AuthoredFiles(root).validateRequired();
  await writeFile(
    join(root, 'config.json'),
    JSON.stringify({
      ...config,
      application: { ...config.application, loginEnabled: false },
    }),
  );
  const runtime = await createRuntime({
    config,
    paths: { root, database: join(root, 'data/app.db'), schema: SCHEMA },
  });
  t.after(() => runtime.close());
  assert.equal((await runtime.app.inject('/api/bootstrap')).statusCode, 401);
});
