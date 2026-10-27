import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { fauxProvider } from '@earendil-works/pi-ai';

import { assembleAttempt } from './assemble.js';
import { AuthoredFiles } from './authored.js';
import { formatElapsedDuration } from './prompt-macros.js';
import { searchHistory } from './storage.js';
import {
  disposeTestFixture,
  createTestFixture,
  seedExchange,
} from './test-helper.js';

function admitReply(
  fixture: Awaited<ReturnType<typeof createTestFixture>>,
  sessionId: string,
  text: string,
  now: string,
  attachmentIds?: readonly string[],
): { positionId: string; variantId: string } {
  const variantId = randomUUID();
  return fixture.runtime.storage.admitAttempt({
    sessionId,
    target: {
      kind: 'reply',
      source: text,
      ...(attachmentIds === undefined ? {} : { attachmentIds }),
    },
    variantId,
    now,
  });
}

test('elapsed durations use only the largest two useful units', () => {
  assert.equal(formatElapsedDuration(0), '0s');
  assert.equal(formatElapsedDuration(59.9), '59s');
  assert.equal(formatElapsedDuration(2_938), '48m 58s');
  assert.equal(formatElapsedDuration(7_380), '2h 3m');
  assert.equal(formatElapsedDuration(367_200), '4d 6h');
});

test('assembleAttempt reads authority once into an immutable input', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const session = fixture.runtime.storage.createSession({
    id: randomUUID(),
    botSlug: 'echo',
    presetSlug: 'default',
    now: new Date('2026-08-14T12:00:00.000Z').toISOString(),
  });
  const admitted = admitReply(
    fixture,
    session.id,
    'Hello',
    '2026-08-14T12:00:00.000Z',
  );

  const authored = new AuthoredFiles(fixture.root);
  const readAttempt = context.mock.method(authored, 'readAttempt');
  const assembly = await assembleAttempt({
    sessionId: session.id,
    ...admitted,
    storage: fixture.runtime.storage,
    authored,
    capabilities: fixture.runtime.capabilities,
    models: fixture.models,
    now: new Date('2026-08-14T12:00:00.000Z'),
  });

  assert.equal(readAttempt.mock.callCount(), 1);
  assert.equal(Object.isFrozen(assembly), true);
  assert.equal(Object.isFrozen(assembly.context), true);
  assert.equal(Object.isFrozen(assembly.context.messages), true);
  assert.equal(Object.isFrozen(assembly.context.messages.at(-1)), true);
  assert.equal(Object.isFrozen(assembly.model), true);
  assert.equal(Object.isFrozen(assembly.tools), true);
  const tool = assembly.tools[0];
  assert.ok(tool);
  assert.equal(Object.isFrozen(tool.parameters), true);
  const providerTool = assembly.context.tools?.[0];
  assert.ok(providerTool);
  assert.equal(providerTool.name, tool.name);
  assert.equal(providerTool.parameters, tool.parameters);
  assert.equal('execute' in providerTool, false);
  assert.match(assembly.context.systemPrompt ?? '', /<bot>/u);
  assert.match(assembly.context.systemPrompt ?? '', /Echo description/u);
  assert.match(assembly.context.systemPrompt ?? '', /Today is/u);
  assert.deepEqual(assembly.context.messages.at(-1), {
    role: 'user',
    content: 'Hello',
    timestamp: Date.parse('2026-08-14T12:00:00.000Z'),
  });
  assert.equal(assembly.streamOptions.maxRetries, 0);
  assert.equal(assembly.streamOptions.headers, undefined);
});

test('bot depth prompt and inherited post-history use their runtime positions', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const now = '2026-08-14T12:00:00.000Z';
  const cardPath = join(fixture.root, 'bots', 'echo', 'echo.json');
  const card = JSON.parse(await readFile(cardPath, 'utf8')) as {
    data: Record<string, unknown>;
  };
  card.data.extensions = {
    depth_prompt: {
      prompt: 'Depth {{getvar::mood}}',
      depth: 1,
    },
  };
  await writeFile(cardPath, JSON.stringify(card));
  const presetPath = join(fixture.root, 'presets', 'default.json');
  const preset = JSON.parse(await readFile(presetPath, 'utf8')) as {
    prompts: Record<string, unknown>;
  };
  preset.prompts.postHistory = 'Post {{listvars}}';
  await writeFile(presetPath, JSON.stringify(preset));
  const session = fixture.runtime.storage.createSession({
    id: randomUUID(),
    botSlug: 'echo',
    presetSlug: 'default',
    now,
  });
  fixture.runtime.storage.setVariable(session.id, 'mood', 'bright', now);
  seedExchange(fixture, {
    sessionId: session.id,
    user: 'Earlier user.',
    assistant: 'Earlier assistant.',
    now,
    lock: true,
  });
  const admitted = admitReply(fixture, session.id, 'Current user.', now);
  const assembly = await assembleAttempt({
    sessionId: session.id,
    ...admitted,
    storage: fixture.runtime.storage,
    authored: new AuthoredFiles(fixture.root),
    capabilities: fixture.runtime.capabilities,
    models: fixture.models,
    now: new Date(now),
  });
  assert.deepEqual(
    assembly.context.messages.map((message) =>
      typeof message.content === 'string'
        ? message.content
        : message.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join(''),
    ),
    [
      'Earlier user.',
      '<depth_prompt>\nDepth bright\n</depth_prompt>',
      'Earlier assistant.',
      '<post_history_instructions>\nPost mood: bright\n</post_history_instructions>',
      'Current user.',
    ],
  );
});

test('bot System opens the prompt, final Instructions remain, and post-history replaces its default', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const now = '2026-08-14T12:00:00.000Z';
  const cardPath = join(fixture.root, 'bots', 'echo', 'echo.json');
  const card = JSON.parse(await readFile(cardPath, 'utf8')) as {
    data: Record<string, unknown>;
  };
  card.data.system_prompt = 'Bot system';
  card.data.post_history_instructions = 'Bot post';
  await writeFile(cardPath, JSON.stringify(card));
  const presetPath = join(fixture.root, 'presets', 'default.json');
  const preset = JSON.parse(await readFile(presetPath, 'utf8')) as {
    prompts: Record<string, unknown>;
  };
  preset.prompts.system = 'Preset system';
  preset.prompts.instructions = 'Final instructions';
  preset.prompts.postHistory = 'Preset post';
  await writeFile(presetPath, JSON.stringify(preset));
  const session = fixture.runtime.storage.createSession({
    id: randomUUID(),
    botSlug: 'echo',
    presetSlug: 'default',
    now,
  });
  const admitted = admitReply(fixture, session.id, 'Hello', now);

  const assembly = await assembleAttempt({
    sessionId: session.id,
    ...admitted,
    storage: fixture.runtime.storage,
    authored: new AuthoredFiles(fixture.root),
    capabilities: fixture.runtime.capabilities,
    models: fixture.models,
    now: new Date(now),
  });
  assert.ok(assembly.context.systemPrompt?.startsWith('Bot system'));
  assert.doesNotMatch(assembly.context.systemPrompt ?? '', /Preset system/u);
  assert.ok(
    assembly.context.systemPrompt?.endsWith(
      '<instructions>\nFinal instructions\n</instructions>',
    ),
  );
  const source = assembly.context.messages
    .map((message) => message.content)
    .filter((content): content is string => typeof content === 'string')
    .join('\n');
  assert.match(source, /Bot post/u);
  assert.doesNotMatch(source, /Preset post/u);
});

test('assembly reads an image after admission binds it to the reply', async (context) => {
  const fixture = await createTestFixture({
    faux: fauxProvider({
      provider: `faux-bound-image-${Date.now().toString(36)}`,
      models: [{ id: 'vision', input: ['text', 'image'] }],
    }),
  });
  context.after(() => disposeTestFixture(fixture));
  const now = '2026-08-14T12:00:00.000Z';
  const session = fixture.runtime.storage.createSession({
    id: randomUUID(),
    botSlug: 'echo',
    presetSlug: 'default',
    now,
  });
  const data = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const attachment = await fixture.runtime.storage.importAttachment({
    sessionId: session.id,
    filename: 'pixel.png',
    data,
    maxDimension: 10,
    now,
  });
  const admitted = admitReply(
    fixture,
    session.id,
    'What is in this image?',
    now,
    [attachment.id],
  );

  const assembly = await assembleAttempt({
    sessionId: session.id,
    ...admitted,
    storage: fixture.runtime.storage,
    authored: new AuthoredFiles(fixture.root),
    capabilities: fixture.runtime.capabilities,
    models: fixture.models,
    now: new Date(now),
  });
  const message = assembly.context.messages.at(-1);
  assert.ok(message);
  assert.equal(message.role, 'user');
  if (typeof message.content === 'string') throw new Error('Missing image');
  assert.deepEqual(message.content.at(-1), {
    type: 'image',
    data: data.toString('base64'),
    mimeType: 'image/png',
  });
});

test('time tools return concise values from the immutable attempt snapshot', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const prior = '2026-08-14T12:00:00.000Z';
  const now = '2026-08-14T12:30:00.000Z';
  const session = fixture.runtime.storage.createSession({
    id: randomUUID(),
    botSlug: 'echo',
    presetSlug: 'default',
    now: prior,
  });
  seedExchange(fixture, {
    sessionId: session.id,
    user: 'Earlier',
    assistant: 'Answer',
    now: prior,
    lock: true,
  });
  const admitted = admitReply(fixture, session.id, 'Hello again', now);
  const assembly = await assembleAttempt({
    sessionId: session.id,
    ...admitted,
    storage: fixture.runtime.storage,
    authored: new AuthoredFiles(fixture.root),
    capabilities: fixture.runtime.capabilities,
    models: fixture.models,
    now: new Date(now),
  });
  const idle = assembly.tools.find((tool) => tool.name === 'system__idle_time');
  assert.ok(idle);
  const result = await idle.execute({}, new AbortController().signal);
  if (typeof result !== 'string') throw new Error('Unexpected idle effect');
  assert.equal(result, '30m 0s');
  const wallClock = assembly.tools.find(
    (tool) => tool.name === 'system__wall_clock',
  );
  assert.ok(wallClock);
  assert.equal(
    await wallClock.execute({}, new AbortController().signal),
    'Friday, August 14, 2026 at 12:30:00 PM UTC',
  );
  const calculator = assembly.tools.find(
    (tool) => tool.name === 'system__calculator',
  );
  assert.ok(calculator);
  assert.equal(
    await calculator.execute(
      { expression: '2 ^ 8 + 1' },
      new AbortController().signal,
    ),
    '257',
  );
  const variables = assembly.tools.find(
    (tool) => tool.name === 'system__variable_list',
  );
  assert.ok(variables);
  assert.equal(await variables.execute({}, new AbortController().signal), '[]');
  const sessionList = assembly.tools.find(
    (tool) => tool.name === 'system__bot_session_list',
  );
  assert.ok(sessionList);
  assert.equal(
    await sessionList.execute({}, new AbortController().signal),
    'No conversations.',
  );

  const firstSession = fixture.runtime.storage.createSession({
    id: randomUUID(),
    botSlug: 'echo',
    presetSlug: 'default',
    now,
  });
  const firstAdmitted = admitReply(fixture, firstSession.id, 'Hello', now);
  const firstAssembly = await assembleAttempt({
    sessionId: firstSession.id,
    ...firstAdmitted,
    storage: fixture.runtime.storage,
    authored: new AuthoredFiles(fixture.root),
    capabilities: fixture.runtime.capabilities,
    models: fixture.models,
    now: new Date(now),
  });
  const firstIdle = firstAssembly.tools.find(
    (tool) => tool.name === 'system__idle_time',
  );
  assert.ok(firstIdle);
  assert.equal(await firstIdle.execute({}, new AbortController().signal), '0s');
  const firstSessionList = firstAssembly.tools.find(
    (tool) => tool.name === 'system__bot_session_list',
  );
  assert.ok(firstSessionList);
  assert.equal(
    await firstSessionList.execute({}, new AbortController().signal),
    'Earlier',
  );
});

test('weekday and idle duration macros use the immutable attempt snapshot', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const prior = '2026-08-14T12:00:00.000Z';
  const now = '2026-08-14T12:30:00.000Z';
  const session = fixture.runtime.storage.createSession({
    id: randomUUID(),
    botSlug: 'echo',
    presetSlug: 'default',
    now: prior,
  });
  seedExchange(fixture, {
    sessionId: session.id,
    user: 'Earlier',
    assistant: 'Answer',
    now: prior,
    lock: true,
  });
  const presetPath = join(fixture.root, 'presets', 'default.json');
  const preset = JSON.parse(await readFile(presetPath, 'utf8')) as {
    prompts: { system: string };
  };
  preset.prompts.system = '{{weekday}} | {{idleDuration}} | {{idle_duration}}';
  await writeFile(presetPath, JSON.stringify(preset));
  const admitted = admitReply(fixture, session.id, 'Hello again', now);

  const assembly = await assembleAttempt({
    sessionId: session.id,
    ...admitted,
    storage: fixture.runtime.storage,
    authored: new AuthoredFiles(fixture.root),
    capabilities: fixture.runtime.capabilities,
    models: fixture.models,
    now: new Date(now),
  });

  assert.ok(assembly.context.systemPrompt);
  assert.match(assembly.context.systemPrompt, /Friday \| 30m 0s \| 30m 0s/u);
});

test('startup requires config without requiring a particular preset or shipped bot', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  await rm(join(fixture.root, 'bots'), { recursive: true, force: true });
  const authored = new AuthoredFiles(fixture.root);
  await assert.doesNotReject(authored.validateRequired());

  await rename(
    join(fixture.root, 'presets', 'default.json'),
    join(fixture.root, 'presets', 'default.missing.json'),
  );
  await assert.doesNotReject(authored.validateRequired());
});

test('a long transcript assembles through one leaf while exact history remains searchable', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const now = new Date('2026-08-14T12:00:00.000Z').toISOString();
  const session = fixture.runtime.storage.createSession({
    id: randomUUID(),
    botSlug: 'echo',
    presetSlug: 'default',
    now,
  });
  for (let index = 0; index < 200; index += 1) {
    seedExchange(fixture, {
      sessionId: session.id,
      user: `Long user ${String(index)}`,
      assistant: `Long assistant ${String(index)}`,
      now,
      lock: true,
    });
  }
  const leaf = fixture.runtime.storage.createPendingLeaf({
    sessionId: session.id,
    liveTailExchanges: 10,
    now,
  });
  assert.ok(leaf);
  fixture.runtime.storage.commitLeaf(leaf.id, 'Long continuity', 'model', now);
  const admitted = admitReply(fixture, session.id, 'Continue', now);

  const assembly = await assembleAttempt({
    sessionId: session.id,
    ...admitted,
    storage: fixture.runtime.storage,
    authored: new AuthoredFiles(fixture.root),
    capabilities: fixture.runtime.capabilities,
    models: fixture.models,
    now: new Date(now),
  });
  assert.equal(assembly.context.messages.length, 22);
  assert.match(
    typeof assembly.context.messages[0]?.content === 'string'
      ? assembly.context.messages[0].content
      : '',
    /Long continuity/u,
  );
  const messageMatch = searchHistory(
    fixture.runtime.storage.statements,
    session.id,
    'Long user 0',
    5,
  )[0];
  assert.deepEqual(messageMatch, {
    kind: 'message',
    number: 1,
    content: 'Long user 0',
    snippet: '[Long] [user] [0]',
  });
  const summaryMatch = searchHistory(
    fixture.runtime.storage.statements,
    session.id,
    'Long continuity',
    5,
  )[0];
  if (summaryMatch?.kind !== 'summary') {
    throw new Error('Missing summary');
  }
  assert.deepEqual(
    {
      number: summaryMatch.number,
      content: summaryMatch.content,
    },
    { number: 1, content: 'Long continuity' },
  );
});

test('assembly does not read images covered by a committed leaf', async (context) => {
  const fixture = await createTestFixture({
    faux: fauxProvider({
      provider: `faux-image-${Date.now().toString(36)}`,
      models: [{ id: 'vision', input: ['text', 'image'] }],
    }),
  });
  context.after(() => disposeTestFixture(fixture));
  const now = new Date('2026-08-14T12:00:00.000Z').toISOString();
  const session = fixture.runtime.storage.createSession({
    id: randomUUID(),
    botSlug: 'echo',
    presetSlug: 'default',
    now,
  });
  const attachment = await fixture.runtime.storage.importAttachment({
    sessionId: session.id,
    filename: 'pixel.png',
    data: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
    maxDimension: 10,
    now,
  });
  seedExchange(fixture, {
    sessionId: session.id,
    user: 'Old image',
    assistant: 'Seen',
    now,
    attachmentIds: [attachment.id],
    lock: true,
  });
  seedExchange(fixture, {
    sessionId: session.id,
    user: 'Recent text',
    assistant: 'Recent answer',
    now,
    lock: true,
  });
  const leaf = fixture.runtime.storage.createPendingLeaf({
    sessionId: session.id,
    liveTailExchanges: 1,
    now,
  });
  assert.ok(leaf);
  fixture.runtime.storage.commitLeaf(
    leaf.id,
    'Image already summarized',
    'model',
    now,
  );
  const attachmentDirectory = join(fixture.root, 'data', 'attachments');
  await Promise.all(
    (await readdir(attachmentDirectory)).map((file) =>
      unlink(join(attachmentDirectory, file)),
    ),
  );
  const admitted = admitReply(fixture, session.id, 'Continue', now);

  const assembly = await assembleAttempt({
    sessionId: session.id,
    ...admitted,
    storage: fixture.runtime.storage,
    authored: new AuthoredFiles(fixture.root),
    capabilities: fixture.runtime.capabilities,
    models: fixture.models,
    now: new Date(now),
  });
  assert.equal(assembly.context.messages.length, 4);
});

test('variable macros read current session state at assembly', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const now = new Date('2026-08-14T12:00:00.000Z').toISOString();
  const session = fixture.runtime.storage.createSession({
    id: randomUUID(),
    botSlug: 'echo',
    presetSlug: 'default',
    now,
  });
  const { positionId } = seedExchange(fixture, {
    sessionId: session.id,
    user: 'Remember',
    assistant: 'Okay',
    now,
    effects: [
      { type: 'variable_set', arguments: { name: 'mood', value: 'bright' } },
    ],
  });
  fixture.runtime.storage.acceptPosition(session.id, positionId, now);
  await fixture.runtime.storage.drainEffects(session.id, now, 'UTC');
  const presetPath = join(fixture.root, 'presets', 'default.json');
  const preset = JSON.parse(await readFile(presetPath, 'utf8')) as {
    prompts: { system: string };
  };
  preset.prompts.system = '{{getvar::mood}}\n{{listvars}}';
  await writeFile(presetPath, JSON.stringify(preset));
  const admitted = admitReply(fixture, session.id, 'Now', now);

  const assembly = await assembleAttempt({
    sessionId: session.id,
    ...admitted,
    storage: fixture.runtime.storage,
    authored: new AuthoredFiles(fixture.root),
    capabilities: fixture.runtime.capabilities,
    models: fixture.models,
    now: new Date(now),
  });
  assert.match(assembly.context.systemPrompt ?? '', /bright\nmood: bright/u);
});
