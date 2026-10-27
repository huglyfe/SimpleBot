import { disposeTestFixture, writeBotSettings } from './test-helper.js';
import assert from 'node:assert/strict';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { AuthoredFiles, AuthoredValidationError } from './authored.js';
import { buildAttemptTools, searchExternalTools } from './assemble-tools.js';
import { activateCapabilities, ActivatedCapabilities } from './capabilities.js';
import { activateDocker } from './docker.js';
import { McpCallUnresolvedError, McpResources, McpToolError } from './mcp.js';
import { createTestFixture } from './test-helper.js';

const TEST_SERVER = fileURLToPath(
  new URL('../test/mcp-server.ts', import.meta.url),
);
const TSX_LOADER = import.meta.resolve('tsx');

test('bot capabilities are exact, unique, and clean-slate', async (context) => {
  const root = await authoredRoot();
  context.after(() => rm(root, { recursive: true, force: true }));
  const authored = new AuthoredFiles(root);
  const unknown = { kind: 'tool', name: 'mcp__missing__tool' } as const;
  await writeBotSettings(root, { capabilities: [unknown] });
  assert.deepEqual(
    (await authored.readAttempt('echo', 'default')).bot.capabilities,
    [unknown],
  );

  for (const invalid of [
    { capabilities: [unknown, unknown] },
    {
      capabilities: [
        { kind: 'memory', dependency: 'one' },
        { kind: 'memory', dependency: 'two' },
      ],
    },
    {
      capabilities: [
        { kind: 'terminal', dependency: 'one' },
        { kind: 'terminal', dependency: 'two' },
      ],
    },
  ]) {
    await writeBotSettings(root, invalid);
    await assert.rejects(
      authored.readAttempt('echo', 'default'),
      AuthoredValidationError,
    );
  }
});

test('configured credentials are exact environment references', async (context) => {
  const root = await authoredRoot({
    mcpServers: {
      weather: mcpDefinition({
        TOKEN: '${TOKEN}',
      }),
    },
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  const authored = new AuthoredFiles(root);
  const draft = await authored.readDependencyConfig();
  const weather = draft.value.mcpServers.weather;
  if (weather?.type !== 'stdio') throw new Error('Missing weather config');
  assert.deepEqual(weather.env, {
    FIXTURE_PATH: '${SIMPLEBOT_CAPABILITY_FIXTURE_PATH}',
    TOKEN: '${TOKEN}',
  });
  await authored.writeDependencyConfig(draft.value, draft.revision);
  const validSource = await readFile(join(root, 'config.json'), 'utf8');
  const stored = JSON.parse(validSource) as {
    application: { timezone: string };
    mcpServers: { weather: { env: Record<string, string> } };
  };
  assert.equal(stored.application.timezone, 'UTC');
  assert.equal(stored.mcpServers.weather.env.TOKEN, '${TOKEN}');
  assert.equal(
    stored.mcpServers.weather.env.FIXTURE_PATH,
    '${SIMPLEBOT_CAPABILITY_FIXTURE_PATH}',
  );

  for (const invalid of [
    { providers: { faux: { apiKey: 'literal' } } },
    {
      mcpServers: {
        weather: { ...mcpDefinition(), env: { TOKEN: '' } },
      },
    },
    { memoryServers: { weather: mcpDefinition() } },
    { mcpServers: { weather__other: mcpDefinition() } },
    { mcpServers: { weather_: mcpDefinition() } },
    {
      tts: {
        baseUrl: 'https://example.com',
        apiKey: 'literal',
        model: 'test',
      },
    },
  ]) {
    await writeFile(
      join(root, 'config.json'),
      JSON.stringify({ ...(JSON.parse(validSource) as object), ...invalid }),
    );
    await assert.rejects(authored.validateRequired(), AuthoredValidationError);
  }
});

test('activation publishes one small fixed catalog and selection implies bridge tools', async (context) => {
  process.env.SIMPLEBOT_DISABLE_RECALL = '1';
  context.after(() => {
    delete process.env.SIMPLEBOT_DISABLE_RECALL;
  });
  const root = await authoredRoot({
    mcpServers: { tools: mcpDefinition() },
    memoryServers: {
      weather: mcpDefinition(),
      invalid: mcpDefinition({
        DISABLE_RECALL: '${SIMPLEBOT_DISABLE_RECALL}',
      }),
      offline: { type: 'stdio', command: 'missing-memory-server' },
    },
  });
  await skill(join(root, 'skills', 'local'), 'local');
  const authored = new AuthoredFiles(root);
  const activated = await activateCapabilities(
    authored,
    await authored.validateRequired(),
  );
  context.after(async () => {
    await activated.close();
    await rm(root, { recursive: true, force: true });
  });
  assert.deepEqual(activated.catalog.dependencies.slice(0, 3), [
    { kind: 'mcp', name: 'tools', available: true, error: null },
    { kind: 'memory', name: 'weather', available: true, error: null },
    {
      kind: 'memory',
      name: 'invalid',
      available: false,
      error: 'Memory servers must expose read-only recall',
    },
  ]);
  // The transport's own failure reaches the operator: a generic line here told
  // them something broke without telling them the command does not exist.
  const offline = activated.catalog.dependencies.find(
    (dependency) => dependency.name === 'offline',
  );
  assert.ok(offline !== undefined);
  assert.equal(offline.available, false);
  assert.match(offline.error ?? '', /missing-memory-server/u);
  assert.deepEqual(
    activated.catalog.capabilities.find(
      (item) => item.kind === 'skill' && item.name === 'local',
    ),
    {
      kind: 'skill',
      name: 'local',
      description: 'Focused test skill.',
      available: true,
    },
  );
  assert.equal(
    activated.catalog.capabilities.some(
      (item) => item.kind === 'tool' && item.name === 'system__skill_read',
    ),
    false,
  );
  assert.deepEqual(
    activated.catalog.capabilities.find(
      (item) => item.kind === 'memory' && item.dependency === 'weather',
    ),
    {
      kind: 'memory',
      dependency: 'weather',
      retains: true,
      available: true,
    },
  );
  assert.deepEqual(
    activated.catalog.capabilities.find(
      (item) => item.kind === 'memory' && item.dependency === 'offline',
    ),
    {
      kind: 'memory',
      dependency: 'offline',
      retains: false,
      available: false,
    },
  );
  assert.deepEqual(
    activated.catalog.capabilities.find(
      (item) => item.kind === 'memory' && item.dependency === 'invalid',
    ),
    {
      kind: 'memory',
      dependency: 'invalid',
      retains: false,
      available: false,
    },
  );
  assert.equal(
    activated.catalog.capabilities.some(
      (item) =>
        item.kind === 'tool' &&
        (item.name === 'mcp__weather__recall' ||
          item.name === 'mcp__weather__retain'),
    ),
    false,
  );
  assert.equal(
    activated.catalog.capabilities.some(
      (item) => item.kind === 'tool' && item.name === 'mcp__tools__recall',
    ),
    true,
  );
  const selected = activated.select([
    { kind: 'tool', name: 'system__calculator' },
    { kind: 'tool', name: 'mcp__weather__weather' },
    { kind: 'skill', name: 'local' },
    { kind: 'tool', name: 'mcp__weather__recall' },
    { kind: 'tool', name: 'mcp__weather__retain' },
    { kind: 'tool', name: 'mcp__missing__tool' },
  ]);
  assert.deepEqual(selected.toolNames, [
    'system__calculator',
    'system__tool_search',
    'system__tool_call',
    'system__skill_read',
  ]);
  assert.deepEqual(
    selected.externalTools.map((tool) => tool.name),
    ['mcp__weather__weather'],
  );
  const oldNames = activated.select([
    { kind: 'tool', name: 'system.calculator' },
    { kind: 'tool', name: 'system_calculator' },
    { kind: 'tool', name: 'weather.weather' },
  ]);
  assert.deepEqual(oldNames.toolNames, []);
  assert.deepEqual(oldNames.externalTools, []);
  assert.deepEqual(
    selected.skills.map((skill) => skill.name),
    ['local'],
  );
  await activated.call(
    'mcp__weather__enable_extra',
    {},
    new AbortController().signal,
  );
  assert.equal(
    activated.catalog.capabilities.some(
      (item) => item.kind === 'tool' && item.name === 'mcp__weather__extra',
    ),
    false,
  );
});

test('MCP tool failures are definite and transport interruption is unresolved', async (context) => {
  const root = await authoredRoot({
    mcpServers: { weather: mcpDefinition() },
  });
  const authored = new AuthoredFiles(root);
  const activated = await activateCapabilities(
    authored,
    await authored.validateRequired(),
  );
  context.after(async () => {
    await activated.close();
    await rm(root, { recursive: true, force: true });
  });
  await assert.rejects(
    activated.call('mcp__weather__fail', {}, new AbortController().signal),
    McpToolError,
  );
  assert.match(
    await activated.call(
      'mcp__weather__weather',
      { city: 'Raleigh' },
      new AbortController().signal,
    ),
    /sunny/u,
  );
  const controller = new AbortController();
  const pending = activated.call(
    'mcp__weather__write_note',
    { text: 'maybe', delayMs: 1_000 },
    controller.signal,
  );
  controller.abort();
  await assert.rejects(pending, McpCallUnresolvedError);
});

test('tool search accepts natural phrases and exact canonical names', async (context) => {
  const root = await authoredRoot({
    mcpServers: { weather: mcpDefinition() },
  });
  const authored = new AuthoredFiles(root);
  const activated = await activateCapabilities(
    authored,
    await authored.validateRequired(),
  );
  context.after(async () => {
    await activated.close();
    await rm(root, { recursive: true, force: true });
  });
  const desired = activated.catalog.capabilities.flatMap((capability) =>
    capability.kind === 'tool' && capability.name.startsWith('mcp__weather__')
      ? [{ kind: 'tool' as const, name: capability.name }]
      : [],
  );
  const tools = activated.select(desired).externalTools;

  assert.equal(
    searchExternalTools(tools, 'weather tool for current weather by city', 1)[0]
      ?.name,
    'mcp__weather__weather',
  );
  assert.equal(
    searchExternalTools(tools, 'mcp__weather__fail', 1)[0]?.name,
    'mcp__weather__fail',
  );
  assert.deepEqual(searchExternalTools(tools, 'unrelated astronomy', 10), []);
});

test('MCP names normalize for discovery but dispatch the exact native name', async (context) => {
  process.env.SIMPLEBOT_TEST_TOOL_NAMES = 'lookup.current';
  context.after(() => delete process.env.SIMPLEBOT_TEST_TOOL_NAMES);
  const root = await authoredRoot({
    mcpServers: {
      system: mcpDefinition({
        FIXTURE_TOOL_NAMES: '${SIMPLEBOT_TEST_TOOL_NAMES}',
      }),
    },
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  const authored = new AuthoredFiles(root);
  const activated = await activateCapabilities(
    authored,
    await authored.validateRequired(),
  );
  context.after(() => activated.close());
  const selected = activated.select([
    { kind: 'tool', name: 'mcp__system__lookup_current' },
    { kind: 'tool', name: 'system__calculator' },
  ]);
  assert.deepEqual(selected.toolNames, [
    'system__calculator',
    'system__tool_search',
    'system__tool_call',
  ]);
  assert.equal(
    searchExternalTools(selected.externalTools, 'lookup current', 1)[0]?.name,
    'mcp__system__lookup_current',
  );
  assert.equal(
    await activated.call(
      'mcp__system__lookup_current',
      { city: 'Boston' },
      new AbortController().signal,
    ),
    'lookup.current: Boston',
  );
  await assert.rejects(
    activated.call(
      'system.lookup.current',
      { city: 'Boston' },
      new AbortController().signal,
    ),
    /Unavailable MCP tool/u,
  );
});

test('normalized MCP name collisions leave the dependency unavailable', async (context) => {
  process.env.SIMPLEBOT_TEST_TOOL_NAMES = 'lookup.current,lookup_current';
  context.after(() => delete process.env.SIMPLEBOT_TEST_TOOL_NAMES);
  const root = await authoredRoot({
    mcpServers: {
      weather: mcpDefinition({
        FIXTURE_TOOL_NAMES: '${SIMPLEBOT_TEST_TOOL_NAMES}',
      }),
    },
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  const authored = new AuthoredFiles(root);
  const activated = await activateCapabilities(
    authored,
    await authored.validateRequired(),
  );
  context.after(() => activated.close());
  assert.deepEqual(activated.catalog.dependencies, [
    {
      kind: 'mcp',
      name: 'weather',
      available: false,
      error:
        'Duplicate MCP tool name after normalization: mcp__weather__lookup_current',
    },
  ]);
  assert.deepEqual(
    activated.select([{ kind: 'tool', name: 'mcp__weather__lookup_current' }])
      .externalTools,
    [],
  );
});

test('Docker resolves and starts once, then uses the immutable container ID', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'simplebot-docker-'));
  const executable = join(root, 'docker');
  const log = join(root, 'calls');
  await writeFile(
    executable,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\ncase "$2" in\n  inspect) printf '%064d\\tstopped\\n' 0 ;;\n  exec) printf 'terminal output' ;;\nesac\n`,
  );
  await chmod(executable, 0o700);
  const docker = await activateDocker(
    { workspace: 'owned-container' },
    executable,
  );
  context.after(async () => {
    await docker.close();
    await rm(root, { recursive: true, force: true });
  });
  assert.equal(
    await docker.run(
      'workspace',
      'pwd',
      { timeoutMs: 1_000, maxOutputChars: 100 },
      new AbortController().signal,
    ),
    'terminal output',
  );
  const calls = await readFile(log, 'utf8');
  assert.equal(calls.match(/container inspect/gu)?.length, 1);
  assert.equal(calls.match(/container start/gu)?.length, 1);
  assert.equal(calls.match(/container exec/gu)?.length, 2);

  await assert.rejects(
    docker.run(
      'missing',
      'pwd',
      { timeoutMs: 1_000, maxOutputChars: 100 },
      new AbortController().signal,
    ),
    /Unavailable Docker target/u,
  );
  const capabilities = new ActivatedCapabilities(
    {
      dependencies: [
        { kind: 'docker', name: 'workspace', available: true, error: null },
      ],
      capabilities: [
        { kind: 'terminal', dependency: 'workspace', available: true },
      ],
    },
    [],
    new McpResources([], []),
    docker,
  );
  assert.deepEqual(
    capabilities.select([{ kind: 'terminal', dependency: 'workspace' }])
      .toolNames,
    ['system__terminal'],
  );
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const tools = buildAttemptTools({
    now: new Date('2026-08-31T12:00:00.000Z'),
    timezone: 'UTC',
    previousUserMessageAt: null,
    variables: {},
    todos: [],
    storage: fixture.runtime.storage,
    sessionId: 'terminal-test',
    botSlug: 'echo',
    capabilities: capabilities.select([
      { kind: 'terminal', dependency: 'workspace' },
    ]),
    resources: capabilities,
    terminalTimeoutMs: 1_000,
    terminalMaxOutputChars: 100,
    maxToolResultChars: 100,
  });
  const terminal = tools.find(
    (candidate) => candidate.name === 'system__terminal',
  );
  assert.ok(terminal);
  const execution = await terminal.execute(
    { command: 'pwd' },
    new AbortController().signal,
  );
  assert.equal(execution, 'terminal output');
  await assert.rejects(
    capabilities.runTerminal(
      'workspace',
      'fail',
      { timeoutMs: 1, maxOutputChars: 100 },
      AbortSignal.abort(),
    ),
    { name: 'AbortError' },
  );
});

function mcpDefinition(env: Record<string, string> = {}) {
  return {
    type: 'stdio' as const,
    command: process.execPath,
    args: ['--import', TSX_LOADER, TEST_SERVER],
    env: { FIXTURE_PATH: '${SIMPLEBOT_CAPABILITY_FIXTURE_PATH}', ...env },
  };
}

async function authoredRoot(overrides: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'simplebot-capabilities-'));
  await Promise.all([
    mkdir(join(root, 'bots', 'echo'), { recursive: true }),
    mkdir(join(root, 'bots', 'help'), { recursive: true }),
    mkdir(join(root, 'presets'), { recursive: true }),
    mkdir(join(root, 'skills'), { recursive: true }),
  ]);
  const config = {
    application: { timezone: 'UTC' },
    providers: { faux: {} },
    mcpServers: {},
    memoryServers: {},
    dockerContainers: {},
    tts: null,
    ...overrides,
  };
  process.env.SIMPLEBOT_CAPABILITY_FIXTURE_PATH = join(root, 'note');
  await Promise.all([
    writeFile(join(root, 'config.json'), JSON.stringify(config)),
    writeFile(
      join(root, 'bots', 'echo', 'echo.json'),
      JSON.stringify({
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: { name: 'Echo' },
      }),
    ),
    writeFile(
      join(root, 'bots', 'help', 'help.json'),
      JSON.stringify({
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: { name: 'Help' },
      }),
    ),
    writeFile(
      join(root, 'presets', 'default.json'),
      JSON.stringify({
        persona: { name: 'Alex', description: '' },
        mainModel: { provider: 'faux', model: 'test' },
        prompts: { system: '', instructions: '' },
      }),
    ),
  ]);
  return root;
}

async function skill(path: string, name: string): Promise<void> {
  await mkdir(path, { recursive: true });
  await writeFile(
    join(path, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Focused test skill.\n---\n`,
  );
}
