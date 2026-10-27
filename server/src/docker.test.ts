import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { activateDocker } from './docker.js';

test('Docker activation distinguishes missing executable, daemon, container, and startup failures without retry', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'simplebot-docker-errors-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const executable = join(root, 'docker');
  const log = join(root, 'calls');
  const missing = await activateDocker({ workspace: 'container' }, executable);
  assert.equal(missing.statuses[0]?.error, 'Docker executable not found');
  await writeFile(
    executable,
    `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
case "$2" in
  inspect) case "$5" in
    daemon) printf 'Cannot connect to the Docker daemon' >&2; exit 1 ;;
    missing) printf 'No such container: missing' >&2; exit 1 ;;
    *) printf '%064d\\tstopped\\n' 1 ;;
  esac ;;
  start) printf 'permission denied' >&2; exit 1 ;;
esac
`,
  );
  await chmod(executable, 0o700);
  const docker = await activateDocker(
    { daemon: 'daemon', missing: 'missing', stopped: 'stopped' },
    executable,
  );
  assert.deepEqual(
    docker.statuses.map(({ error }) => error),
    [
      'Docker inspection failed: Cannot connect to the Docker daemon',
      'Docker inspection failed: No such container: missing',
      'Docker startup failed: permission denied',
    ],
  );
  assert.ok(docker.statuses.every(({ available }) => !available));
  await docker.close();
  const calls = await readFile(log, 'utf8');
  assert.equal(calls.match(/container inspect/gu)?.length, 3);
  assert.equal(calls.match(/container start/gu)?.length, 1);
  assert.equal(calls.match(/container stop/gu)?.length ?? 0, 0);
});

test('Docker stops only what it started and keeps a failed command output', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'simplebot-docker-owned-'));
  const executable = join(root, 'docker');
  const log = join(root, 'calls');
  // `running` is already up, `stopped` is not. `exec` writes to both streams
  // and exits non-zero, the way an ordinary failing command does.
  await writeFile(
    executable,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\ncase "$2" in\n  inspect) case "$5" in\n    running-container) printf '%064d\\trunning\\n' 1 ;;\n    *) printf '%064d\\tstopped\\n' 2 ;;\n  esac ;;\n  exec) printf 'partial output'; printf 'the real reason' >&2; exit 3 ;;\nesac\n`,
  );
  await chmod(executable, 0o700);
  const docker = await activateDocker(
    { attached: 'running-container', owned: 'stopped-container' },
    executable,
  );
  context.after(() => rm(root, { recursive: true, force: true }));

  // A non-zero exit is a result, not a lost one: the operator and the model
  // need what the command printed, not the wrapper's "Command failed".
  const output = await docker.run(
    'owned',
    'false',
    { timeoutMs: 1_000, maxOutputChars: 200 },
    new AbortController().signal,
  );
  assert.match(output, /partial output/u);
  assert.match(output, /the real reason/u);
  assert.match(output, /exited with status 3/u);

  await docker.close();
  const stops = (await readFile(log, 'utf8'))
    .split('\n')
    .filter((line) => line.startsWith('container stop'));
  assert.equal(stops.length, 1);
  // The container this process started, never the one it merely attached to.
  assert.match(stops[0] ?? '', /0{63}2/u);
});

test('Docker ownership follows the same container across dependency reload', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'simplebot-docker-reload-'));
  const executable = join(root, 'docker');
  const running = join(root, 'running');
  const log = join(root, 'calls');
  await writeFile(
    executable,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\ncase "$2" in\n  inspect) if [ -f '${running}' ]; then printf '%064d\\trunning\\n' 3; else printf '%064d\\tstopped\\n' 3; fi ;;\n  start) touch '${running}' ;;\n  stop) rm -f '${running}' ;;\n  exec) if [ -f '${running}' ]; then printf 'running'; else exit 1; fi ;;\nesac\n`,
  );
  await chmod(executable, 0o700);
  context.after(() => rm(root, { recursive: true, force: true }));
  const previous = await activateDocker({ workspace: 'container' }, executable);
  const next = await activateDocker({ workspace: 'container' }, executable);
  previous.transferOwnershipTo(next);
  await previous.close();

  assert.equal(
    await next.run(
      'workspace',
      'true',
      { timeoutMs: 1_000, maxOutputChars: 100 },
      new AbortController().signal,
    ),
    'running',
  );
  await next.close();
  const calls = await readFile(log, 'utf8');
  assert.equal(calls.match(/container start/gu)?.length, 1);
  assert.equal(calls.match(/container stop/gu)?.length, 1);
});
