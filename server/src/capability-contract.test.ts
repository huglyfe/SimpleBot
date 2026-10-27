import {
  fauxAssistantMessage,
  fauxToolCall,
  getCurrentTools,
} from '@earendil-works/pi-ai';
import {
  sessionChangeSchema,
  sessionProjectionSchema,
  type CapabilityCatalog,
  type SessionChange,
  type SessionContext,
  type SessionProjection,
} from '@simplebot/shared';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  disposeTestFixture,
  createSession,
  createTestFixture,
  listen,
  readEvents,
  reopenTestFixture,
  streamAttempt,
  writeBotSettings,
} from './test-helper.js';

test('exact desired tools share one system and MCP catalog', async (context) => {
  const fixture = await createTestFixture();
  await fixture.runtime.close();
  process.env.SIMPLEBOT_TEST_WEATHER_FIXTURE = join(fixture.root, 'note.txt');
  context.after(() => delete process.env.SIMPLEBOT_TEST_WEATHER_FIXTURE);
  await configureMcp(fixture.root, 'weather', 'SIMPLEBOT_TEST_WEATHER_FIXTURE');
  await writeBotSettings(fixture.root, {
    capabilities: [
      { kind: 'tool', name: 'mcp__weather__weather' },
      { kind: 'tool', name: 'mcp__weather__get_wether' },
      { kind: 'tool', name: 'mcp__absent__anything' },
    ],
  });
  const reopened = await reopenTestFixture({
    root: fixture.root,
    faux: fixture.faux,
  });
  context.after(() => reopened.runtime.close());
  const address = await listen(reopened.runtime);

  const catalog = (await (
    await fetch(`${address}/api/capabilities`)
  ).json()) as CapabilityCatalog;
  assert.equal(
    catalog.capabilities.some(
      (item) => item.kind === 'tool' && item.name === 'system__variable_list',
    ),
    true,
  );
  for (const name of [
    'system__calculator',
    'system__wall_clock',
    'system__idle_time',
    'system__bot_session_list',
    'system__bot_history_search',
  ]) {
    assert.equal(
      catalog.capabilities.some(
        (item) => item.kind === 'tool' && item.name === name,
      ),
      true,
      `${name} is missing from the capability catalog`,
    );
  }
  for (const removed of ['system__history_read', 'system__bot_history_read']) {
    assert.equal(
      catalog.capabilities.some(
        (item) => item.kind === 'tool' && item.name === removed,
      ),
      false,
      `${removed} remains in the capability catalog`,
    );
  }
  const weather = catalog.dependencies.find(
    (dependency) => dependency.name === 'weather',
  );
  if (weather?.kind !== 'mcp') throw new Error('Missing weather dependency');
  assert.equal(weather.available, true);
  const weatherTools = catalog.capabilities
    .filter((item) => item.kind === 'tool')
    .filter((item) => item.name.startsWith('mcp__weather__'));
  assert.deepEqual(weatherTools.map((tool) => tool.name).sort(), [
    'mcp__weather__enable_extra',
    'mcp__weather__fail',
    'mcp__weather__recall',
    'mcp__weather__retain',
    'mcp__weather__weather',
    'mcp__weather__write_note',
  ]);
  for (const implementation of [
    'system__skill_read',
    'system__tool_search',
    'system__tool_describe',
    'system__tool_call',
    'system__terminal',
  ])
    assert.equal(
      catalog.capabilities.some(
        (item) => item.kind === 'tool' && item.name === implementation,
      ),
      false,
    );

  // Only the known grant reaches the model's tool bridge, and an ordinary
  // read without annotations executes during generation.
  fixture.faux.setResponses([
    (providerContext) => {
      assert.ok(
        getCurrentTools(providerContext.messages).some(
          (tool) => tool.name === 'system__tool_search',
        ),
      );
      assert.ok(
        getCurrentTools(providerContext.messages).some(
          (tool) => tool.name === 'system__tool_call',
        ),
      );
      return fauxAssistantMessage(
        fauxToolCall('system__tool_search', { query: 'weather', limit: 1 }),
        { stopReason: 'toolUse' },
      );
    },
    (providerContext) => {
      const result = JSON.stringify(providerContext.messages.at(-1));
      assert.match(result, /mcp__weather__weather/u);
      assert.match(result, /inputSchema/u);
      return fauxAssistantMessage(
        fauxToolCall('system__tool_call', {
          name: 'mcp__weather__weather',
          arguments: { city: 'Raleigh' },
        }),
        { stopReason: 'toolUse' },
      );
    },
    (providerContext) => {
      assert.match(JSON.stringify(providerContext.messages.at(-1)), /sunny/u);
      return fauxAssistantMessage('Bridged.');
    },
  ]);
  const sessionId = await createSession(address);
  const events = await readEvents(
    await streamAttempt(address, sessionId, { kind: 'reply', text: 'Tools?' }),
  );
  assert.deepEqual(
    events
      .filter((event) => event.type === 'tool_call')
      .map((event) => event.name),
    ['system__tool_search', 'system__tool_call'],
  );
  assert.deepEqual(
    finalAssistant(await projection(address, sessionId)).variant.effects,
    [],
  );
});

test('an empty desired list exposes no tools and one selection exposes only itself', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  await writeBotSettings(fixture.root, { capabilities: [] });
  fixture.faux.setResponses([
    (providerContext) => {
      assert.deepEqual(getCurrentTools(providerContext.messages), []);
      return fauxAssistantMessage('No capabilities.');
    },
  ]);
  const address = await listen(fixture.runtime);
  const sessionId = await createSession(address);
  await readEvents(
    await streamAttempt(address, sessionId, {
      kind: 'reply',
      text: 'What can you use?',
    }),
  );

  await writeBotSettings(fixture.root, {
    capabilities: [{ kind: 'tool', name: 'system__variable_list' }],
  });
  fixture.faux.appendResponses([
    (providerContext) => {
      assert.deepEqual(
        getCurrentTools(providerContext.messages).map((tool) => tool.name),
        ['system__variable_list'],
      );
      return fauxAssistantMessage('One capability.');
    },
  ]);
  await readEvents(
    await streamAttempt(address, sessionId, {
      kind: 'reply',
      text: 'And now?',
    }),
  );
});

test('MCP writes run immediately on replies, swipes, and schedules while Memory retention waits for acceptance', async (context) => {
  const fixture = await createTestFixture();
  await fixture.runtime.close();
  const note = join(fixture.root, 'external-writes.txt');
  process.env.SIMPLEBOT_TEST_EXTERNAL_WRITES = note;
  const memoryPath = `${note}.memory`;
  process.env.SIMPLEBOT_TEST_MEMORY_WRITES = memoryPath;
  context.after(() => delete process.env.SIMPLEBOT_TEST_MEMORY_WRITES);
  context.after(() => delete process.env.SIMPLEBOT_TEST_EXTERNAL_WRITES);
  await configureMcp(fixture.root, 'tools', 'SIMPLEBOT_TEST_EXTERNAL_WRITES');
  const configPath = join(fixture.root, 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8')) as Record<
    string,
    unknown
  >;
  config.memoryServers = {
    memory: {
      type: 'stdio',
      command: process.execPath,
      args: [
        '--import',
        TSX_LOADER,
        fileURLToPath(new URL('./memory/writable-server.ts', import.meta.url)),
      ],
      env: { MEMORY_PATH: '${SIMPLEBOT_TEST_MEMORY_WRITES}' },
    },
  };
  await writeFile(configPath, JSON.stringify(config));
  await writeBotSettings(fixture.root, {
    capabilities: [
      { kind: 'tool', name: 'mcp__tools__write_note' },
      { kind: 'memory', dependency: 'memory' },
    ],
  });
  const reopened = await reopenTestFixture({
    root: fixture.root,
    faux: fixture.faux,
  });
  context.after(() => reopened.runtime.close());
  const address = await listen(reopened.runtime);
  fixture.faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall('system__tool_call', {
        name: 'mcp__tools__write_note',
        arguments: { text: 'first' },
      }),
      { stopReason: 'toolUse' },
    ),
    (providerContext) => {
      assert.match(JSON.stringify(providerContext.messages.at(-1)), /written/u);
      return fauxAssistantMessage('Written first.');
    },
    fauxAssistantMessage(
      fauxToolCall('system__tool_call', {
        name: 'mcp__tools__write_note',
        arguments: { text: 'second' },
      }),
      { stopReason: 'toolUse' },
    ),
    (providerContext) => {
      assert.match(JSON.stringify(providerContext.messages.at(-1)), /written/u);
      return fauxAssistantMessage('Written now.');
    },
  ]);

  const sessionId = await createSession(address);
  const completed = (
    await readEvents(
      await streamAttempt(address, sessionId, {
        kind: 'reply',
        text: 'Write this.',
      }),
    )
  ).at(-1);
  if (completed?.type !== 'completed') throw new Error('Missing response');
  const first = finalAssistant(await projection(address, sessionId));
  assert.equal(first.variant.source, 'Written first.');
  assert.deepEqual(
    first.variant.effects.map(({ type, state }) => ({ type, state })),
    [{ type: 'mcp:mcp__memory__retain', state: 'candidate' }],
  );
  await assert.rejects(readFile(memoryPath, 'utf8'), { code: 'ENOENT' });
  assert.equal(await readFile(note, 'utf8'), 'first\n');

  await readEvents(
    await streamAttempt(address, sessionId, {
      kind: 'swipe',
      positionId: completed.positionId,
    }),
  );
  assert.equal(await readFile(note, 'utf8'), 'first\nsecond\n');
  assert.equal(
    finalAssistant(await projection(address, sessionId)).variant.source,
    'Written now.',
  );
  assert.deepEqual(
    finalAssistant(await projection(address, sessionId)).variant.effects.map(
      ({ type, state }) => ({ type, state }),
    ),
    [{ type: 'mcp:mcp__memory__retain', state: 'candidate' }],
  );
  await assert.rejects(readFile(memoryPath, 'utf8'), { code: 'ENOENT' });
  const accepted = await fetch(
    `${address}/api/sessions/${sessionId}/positions/${completed.positionId}/accept`,
    { method: 'POST' },
  );
  assert.equal(accepted.status, 200, await accepted.text());
  assert.equal(await readFile(note, 'utf8'), 'first\nsecond\n');
  const retained = JSON.parse(await readFile(memoryPath, 'utf8')) as {
    text: string;
  }[];
  assert.equal(retained.length, 1);
  assert.match(retained[0]?.text ?? '', /Written now/u);
  assert.doesNotMatch(retained[0]?.text ?? '', /Written first/u);

  fixture.faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall('system__tool_call', {
        name: 'mcp__tools__write_note',
        arguments: { text: 'scheduled' },
      }),
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage('Scheduled write complete.'),
  ]);
  await reopened.runtime.attempts.enqueue({
    sessionId,
    command: {
      kind: 'scheduled',
      name: 'Check in',
      prompt: 'Write a note.',
      ranAt: new Date().toISOString(),
    },
    emit: () => undefined,
  }).done;
  assert.equal(await readFile(note, 'utf8'), 'first\nsecond\nscheduled\n');
  const scheduled = finalAssistant(await projection(address, sessionId));
  assert.equal(scheduled.variant.source, 'Scheduled write complete.');
  assert.equal(scheduled.variant.effects[0]?.state, 'candidate');
  assert.equal(
    (JSON.parse(await readFile(memoryPath, 'utf8')) as unknown[]).length,
    1,
  );
});

test('stateful tools become effects and acceptance applies them once', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  fixture.faux.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall('system__variable_set', {
          name: 'mood',
          value: 'curious',
        }),
        fauxToolCall('system__variable_list', {}),
      ],
      { stopReason: 'toolUse' },
    ),
    (input) => {
      const listed = input.messages.at(-1);
      assert.equal(listed?.role, 'toolResult');
      assert.deepEqual(listed.content, [{ type: 'text', text: '[]' }]);
      return fauxAssistantMessage('Ready.');
    },
  ]);
  const address = await listen(fixture.runtime);
  const sessionId = await createSession(address);
  const completed = (
    await readEvents(
      await streamAttempt(address, sessionId, {
        kind: 'reply',
        text: 'Remember this.',
      }),
    )
  ).at(-1);
  if (completed?.type !== 'completed') throw new Error('Missing response');

  let session = await projection(address, sessionId);
  let state = (await (
    await fetch(`${address}/api/sessions/${sessionId}/context`)
  ).json()) as SessionContext;
  assert.deepEqual(state.variables, []);
  assert.equal(finalAssistant(session).variant.source, 'Ready.');
  assert.equal(finalAssistant(session).variant.effects[0]?.state, 'candidate');

  const otherSessionId = await createSession(address);
  const refused = await fetch(
    `${address}/api/sessions/${otherSessionId}/positions/${completed.positionId}/accept`,
    { method: 'POST' },
  );
  assert.equal(refused.status, 409);
  assert.deepEqual(await projection(address, sessionId), session);

  const accepted = await fetch(
    `${address}/api/sessions/${sessionId}/positions/${completed.positionId}/accept`,
    { method: 'POST' },
  );
  assert.equal(accepted.status, 200, await accepted.text());
  session = await projection(address, sessionId);
  state = (await (
    await fetch(`${address}/api/sessions/${sessionId}/context`)
  ).json()) as SessionContext;
  assert.deepEqual(state.variables, [
    {
      name: 'mood',
      value: 'curious',
    },
  ]);
  assert.equal(finalAssistant(session).variant.effects[0]?.state, 'applied');
  assert.equal(
    (
      await fetch(
        `${address}/api/sessions/${sessionId}/positions/${completed.positionId}/accept`,
        { method: 'POST' },
      )
    ).status,
    409,
  );

  fixture.faux.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall('system__variable_list', {}),
        fauxToolCall('system__variable_delete', { name: 'mood' }),
        fauxToolCall('system__variable_list', {}),
      ],
      { stopReason: 'toolUse' },
    ),
    (input) => {
      const reads = input.messages.filter(
        (message) =>
          message.role === 'toolResult' &&
          message.toolName === 'system__variable_list',
      );
      assert.equal(reads.length, 2);
      for (const read of reads)
        assert.deepEqual(read.content, [
          {
            type: 'text',
            text: JSON.stringify([{ name: 'mood', value: 'curious' }]),
          },
        ]);
      return fauxAssistantMessage('Deletion proposed.');
    },
  ]);
  const deletion = (
    await readEvents(
      await streamAttempt(address, sessionId, {
        kind: 'reply',
        text: 'Forget mood.',
      }),
    )
  ).at(-1);
  assert.equal(deletion?.type, 'completed');
  assert.equal(
    finalAssistant(await projection(address, sessionId)).variant.source,
    'Deletion proposed.',
  );
  await mutate(
    address,
    `/api/sessions/${sessionId}/positions/${deletion.positionId}/accept`,
    'POST',
    {},
  );
  const cleared = await fixture.runtime.app.inject(
    `/api/sessions/${sessionId}/context`,
  );
  assert.deepEqual(cleared.json<SessionContext>().variables, []);
});

test('a bare capability string is rejected by field', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const address = await listen(fixture.runtime);
  const current = (await (await fetch(`${address}/api/bots/echo`)).json()) as {
    revision: string;
  };

  const response = await fetch(`${address}/api/bots/echo`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      value: {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
          name: 'Echo',
          extensions: {
            simplebot: { capabilities: ['mcp__weather__weather'] },
          },
        },
      },
      expectedRevision: current.revision,
    }),
  });

  assert.equal(response.status, 400);
  const { error } = (await response.json()) as { error: string };
  assert.match(error, /bots[/\\]echo[/\\]echo\.json is not valid/u);
  assert.match(error, /capabilities\.0/u);
  assert.match(error, /expected object, received string/u);
});

test('dependency settings save independently from refresh and stay out of ordinary settings', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const address = await listen(fixture.runtime);
  const beforeReload = fixture.runtime.capabilities;
  const settings = (await (await fetch(`${address}/api/settings`)).json()) as {
    value: Record<string, unknown>;
  };
  assert.equal('mcpServers' in settings.value, false);
  assert.equal('memoryServers' in settings.value, false);
  assert.equal('dockerContainers' in settings.value, false);

  const dependencies = (await (
    await fetch(`${address}/api/dependencies`)
  ).json()) as {
    value: {
      mcpServers: Record<string, unknown>;
      memoryServers: Record<string, unknown>;
      dockerContainers: Record<string, string>;
    };
    revision: string;
  };
  const saved = await fetch(`${address}/api/dependencies`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      value: dependencies.value,
      expectedRevision: dependencies.revision,
    }),
  });
  assert.equal(saved.status, 200, await saved.text());
  const reread = (await (
    await fetch(`${address}/api/dependencies`)
  ).json()) as { value: unknown; revision: string };
  assert.deepEqual(reread.value, dependencies.value);
  assert.equal(fixture.runtime.capabilities, beforeReload);
  const refreshed = await fetch(`${address}/api/capabilities/refresh`, {
    method: 'POST',
  });
  assert.equal(refreshed.status, 200);
  assert.notEqual(fixture.runtime.capabilities, beforeReload);

  const active = fixture.runtime.capabilities;
  const invalid = await fetch(`${address}/api/dependencies`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      value: { ...dependencies.value, pluginDirectory: 'extensions' },
      expectedRevision: reread.revision,
    }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(fixture.runtime.capabilities, active);

  const stale = await fetch(`${address}/api/dependencies`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      value: dependencies.value,
      expectedRevision: dependencies.revision,
    }),
  });
  assert.equal(stale.status, 409);
  assert.equal(fixture.runtime.capabilities, active);
});

const TSX_LOADER = import.meta.resolve('tsx');

test('bundled Lorebook recalls a SillyTavern export through MCP without retaining or mutating it', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  await fixture.runtime.close();
  const bookPath = join(fixture.root, 'world.json');
  process.env.SIMPLEBOT_TEST_LOREBOOK_PATH = bookPath;
  context.after(() => delete process.env.SIMPLEBOT_TEST_LOREBOOK_PATH);
  const source = JSON.stringify({
    entries: {
      '0': { key: ['harbor'], content: 'The harbor closes at dusk.', uid: 0 },
      '1': { key: ['harbor'], content: 'Disabled lore', disable: true },
      '2': { key: ['mountain'], content: 'Unrelated lore' },
    },
  });
  await writeFile(bookPath, source);
  const configPath = join(fixture.root, 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8')) as Record<
    string,
    unknown
  >;
  config.memoryServers = {
    lorebook: {
      type: 'stdio',
      command: process.execPath,
      args: [
        '--import',
        TSX_LOADER,
        fileURLToPath(new URL('./memory/lorebook-server.ts', import.meta.url)),
      ],
      env: { LOREBOOK_PATH: '${SIMPLEBOT_TEST_LOREBOOK_PATH}' },
    },
  };
  await writeFile(configPath, JSON.stringify(config));
  await writeBotSettings(fixture.root, {
    capabilities: [{ kind: 'memory', dependency: 'lorebook' }],
  });
  const reopened = await reopenTestFixture({
    root: fixture.root,
    faux: fixture.faux,
  });
  fixture.runtime = reopened.runtime;
  const address = await listen(reopened.runtime);
  const catalog = reopened.runtime.capabilities.catalog;
  assert.deepEqual(
    catalog.capabilities.filter((item) => item.kind === 'memory'),
    [
      {
        kind: 'memory',
        dependency: 'lorebook',
        retains: false,
        available: true,
      },
    ],
  );
  assert.equal(
    catalog.capabilities.some(
      (item) => item.kind === 'tool' && item.name.startsWith('mcp__lorebook__'),
    ),
    false,
  );
  let observed = false;
  fixture.faux.setResponses([
    (providerContext) => {
      const messages = JSON.stringify(providerContext.messages);
      assert.match(messages, /<external_memory>/u);
      assert.match(messages, /The harbor closes at dusk\./u);
      assert.doesNotMatch(messages, /Disabled lore|Unrelated lore/u);
      observed = true;
      return fauxAssistantMessage('The harbor is nearby.');
    },
  ]);
  const sessionId = await createSession(address);
  await readEvents(
    await streamAttempt(address, sessionId, { kind: 'reply', text: 'harbor' }),
  );
  assert.equal(observed, true);
  const result = await projection(address, sessionId);
  assert.equal(finalAssistant(result).variant.source, 'The harbor is nearby.');
  assert.deepEqual(finalAssistant(result).variant.effects, []);
  assert.doesNotMatch(
    JSON.stringify(result.positions),
    /The harbor closes at dusk/u,
  );
  assert.equal(await readFile(bookPath, 'utf8'), source);

  const recall = () =>
    reopened.runtime.capabilities.call(
      'mcp__lorebook__recall',
      { query: 'harbor', bot: 'echo', session: sessionId },
      new AbortController().signal,
    );
  // Each call reads the file once; a bad edit is an error, never stale cached lore.
  await writeFile(bookPath, '{');
  await assert.rejects(recall());
  await writeFile(
    bookPath,
    JSON.stringify([{ keys: ['harbor'], content: 'Updated lore' }]),
  );
  assert.equal(await recall(), 'Updated lore');
});

async function configureMcp(
  root: string,
  name: string,
  fixtureEnvironment: string,
): Promise<void> {
  const path = join(root, 'config.json');
  const config = JSON.parse(await readFile(path, 'utf8')) as Record<
    string,
    unknown
  >;
  config.mcpServers = {
    [name]: {
      type: 'stdio',
      command: process.execPath,
      args: ['--import', TSX_LOADER, TEST_MCP_SERVER],
      env: { FIXTURE_PATH: `\${${fixtureEnvironment}}` },
    },
  };
  await writeFile(path, JSON.stringify(config));
}

async function projection(address: string, sessionId: string) {
  const response = await fetch(`${address}/api/sessions/${sessionId}`);
  if (!response.ok) throw new Error(await response.text());
  return flatten(sessionProjectionSchema.parse(await response.json()));
}

function flatten(
  value: SessionProjection,
): SessionChange & Pick<SessionProjection, 'activeAttemptId'> {
  const { page, ...state } = value;
  return { ...state, positions: page.positions };
}

async function mutate(
  address: string,
  path: string,
  method: string,
  body: unknown,
): Promise<SessionChange> {
  const response = await fetch(`${address}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return sessionChangeSchema.parse(await response.json());
}

function finalAssistant(value: {
  positions: SessionChange['positions'];
}): Extract<SessionChange['positions'][number], { role: 'assistant' }> {
  const position = value.positions.at(-1);
  if (position?.role !== 'assistant') throw new Error('Missing assistant');
  return position;
}

const TEST_MCP_SERVER = fileURLToPath(
  new URL('../test/mcp-server.ts', import.meta.url),
);
