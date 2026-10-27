import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import {
  cardSchema,
  botSettings,
  type SessionProjection,
} from '@simplebot/shared';
import { searchHistory } from './storage-search.js';
import { AuthoredFiles } from './authored.js';
import {
  disposeTestFixture,
  createTestFixture,
  reopenTestFixture,
  listen,
  readEvents,
  streamAttempt,
} from './test-helper.js';

const card = (name: string, first = '', alternates: string[] = []) => ({
  spec: 'chara_card_v3',
  spec_version: '3.0',
  data: {
    name,
    first_mes: first,
    alternate_greetings: alternates,
    extensions: {
      foreign: { keep: true },
      simplebot: {
        defaultPreset: 'default',
        capabilities: [{ kind: 'tool', name: 'mcp__unknown__read' }],
      },
    },
    character_book: { entries: [] },
  },
});

test('bot defaults are chosen once by display name and slug, preserved on import, and used after restart', async (t) => {
  const fixture = await createTestFixture();
  let closed = false;
  t.after(() => (closed ? undefined : fixture.runtime.close()));
  const authored = new AuthoredFiles(fixture.root);
  const preset = await authored.readPresetDocument('default');
  for (const slug of ['z-first', 'a-first'])
    await authored.writePresetDocument(
      slug,
      { ...preset.value, name: 'Alphabetical first' },
      'missing',
    );
  assert.deepEqual(
    (await authored.listPresets()).map((preset) => preset.slug),
    ['a-first', 'z-first', 'default'],
  );
  const created = await fixture.runtime.app.inject({
    method: 'POST',
    url: '/api/bots',
    payload: { name: 'New default' },
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(
    await authored.resolveSessionPreset('new-default', undefined),
    'a-first',
  );
  const imported = card('No default');
  const { defaultPreset: _default, ...settings } =
    imported.data.extensions.simplebot;
  const portable = {
    ...imported,
    data: {
      ...imported.data,
      extensions: { ...imported.data.extensions, simplebot: settings },
    },
  };
  await authored.importBot({
    filename: 'card.json',
    data: Buffer.from(JSON.stringify(portable)),
  });
  const saved = await authored.readBotDocument('no-default');
  assert.deepEqual(saved.value, {
    ...portable,
    data: {
      ...portable.data,
      extensions: {
        ...portable.data.extensions,
        simplebot: { ...settings, defaultPreset: 'a-first' },
      },
    },
  });
  await authored.importBot({
    filename: 'explicit.json',
    data: Buffer.from(JSON.stringify(card('Explicit default'))),
  });
  assert.equal(
    await authored.resolveSessionPreset('explicit-default', undefined),
    'default',
  );
  const before = await fixture.runtime.app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: { botSlug: 'new-default' },
  });
  assert.equal(before.statusCode, 201, before.body);
  const sessionId = before.json<{ id: string }>().id;
  await authored.writePresetDocument(
    'earlier',
    { ...preset.value, name: 'AAA earlier' },
    'missing',
  );
  const latest = await authored.readPresetDocument('a-first');
  await authored.writePresetDocument(
    'a-first',
    { ...latest.value, name: 'ZZZ renamed' },
    latest.revision,
  );
  await fixture.runtime.close();
  closed = true;
  const reopened = await reopenTestFixture({
    root: fixture.root,
    faux: fixture.faux,
  });
  t.after(() => reopened.runtime.close());
  assert.equal(
    reopened.runtime.storage
      .listSessions()
      .find((session) => session.id === sessionId)?.presetSlug,
    'a-first',
  );
  assert.equal(
    await new AuthoredFiles(fixture.root).resolveSessionPreset(
      'new-default',
      undefined,
    ),
    'a-first',
  );
});

test('missing bot defaults require a choice and no valid preset refuses installation before writing files', async (t) => {
  const fixture = await createTestFixture();
  t.after(() => disposeTestFixture(fixture));
  const authored = new AuthoredFiles(fixture.root);
  const document = await authored.readBotDocument('echo');
  const source = cardSchema.parse(document.value);
  const missing = {
    ...source,
    data: { ...source.data, extensions: { simplebot: { capabilities: [] } } },
  };
  await assert.rejects(
    authored.writeBotDocument('echo', missing, document.revision),
    /Choose a default preset/u,
  );
  await writeFile(
    join(fixture.root, 'bots', 'echo', 'echo.json'),
    JSON.stringify(missing),
  );
  const refused = await fixture.runtime.app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: { botSlug: 'echo' },
  });
  assert.equal(refused.statusCode, 400, refused.body);
  assert.equal(fixture.runtime.storage.listSessions().length, 0);
  await rm(join(fixture.root, 'presets', 'default.json'));
  await writeFile(join(fixture.root, 'presets', 'broken.json'), '{}');
  await assert.rejects(
    authored.createBot('Cannot install'),
    /Create a preset/u,
  );
  assert.deepEqual((await readdir(join(fixture.root, 'bots'))).sort(), [
    'echo',
    'help',
  ]);
});

test('JSON imports report the source filename and invalid field before installing files', async (t) => {
  const fixture = await createTestFixture();
  t.after(() => disposeTestFixture(fixture));
  const authored = new AuthoredFiles(fixture.root);
  const before = await readdir(join(fixture.root, 'bots'));
  await assert.rejects(
    authored.importBot({
      filename: 'invalid-card.json',
      data: Buffer.from(
        JSON.stringify({
          ...card('Invalid card'),
          data: { ...card('Invalid card').data, name: '' },
        }),
      ),
    }),
    /invalid-card\.json.*data\.name/u,
  );
  assert.deepEqual(await readdir(join(fixture.root, 'bots')), before);
});

test('one card owns settings, preserves unknown fields, and refuses stale saves and invalid presets', async (t) => {
  const fixture = await createTestFixture();
  t.after(() => disposeTestFixture(fixture));
  const authored = new AuthoredFiles(fixture.root);
  const source = card('Ada');
  await authored.importBot({
    filename: 'Ada.json',
    data: Buffer.from(JSON.stringify(source)),
  });
  const directory = join(fixture.root, 'bots', 'ada');
  assert.deepEqual(await readdir(directory), ['ada.json']);
  const initial = await authored.readBotDocument('ada');
  assert.deepEqual(initial.value, source);
  assert.deepEqual(botSettings(cardSchema.parse(initial.value)).capabilities, [
    { kind: 'tool', name: 'mcp__unknown__read' },
  ]);
  await assert.rejects(
    authored.writeBotDocument(
      'ada',
      {
        ...source,
        data: {
          ...source.data,
          extensions: {
            ...source.data.extensions,
            simplebot: { defaultPreset: 'missing' },
          },
        },
      },
      initial.revision,
    ),
    /presets.*missing/u,
  );
  const updated = { ...source, data: { ...source.data, name: 'Updated' } };
  const revision = await authored.writeBotDocument(
    'ada',
    updated,
    initial.revision,
  );
  assert.equal((await authored.readBotDocument('ada')).revision, revision);
  assert.deepEqual(
    JSON.parse(await readFile(join(directory, 'ada.json'), 'utf8')),
    updated,
  );
  await assert.rejects(
    authored.writeBotDocument('ada', source, initial.revision),
    /changed on disk/u,
  );
  await rename(join(directory, 'ada.json'), join(directory, 'renamed.json'));
  await assert.rejects(
    authored.writeBotDocument('ada', source, revision),
    /changed on disk/u,
  );
  await writeFile(join(directory, 'extra.json'), JSON.stringify(source));
  await assert.rejects(authored.readBot('ada'), /exactly one/u);
});

test('card prompts inherit when blank and substitute original and nickname while Instructions stay preset-owned', async (t) => {
  const fixture = await createTestFixture();
  t.after(() => disposeTestFixture(fixture));
  const authored = new AuthoredFiles(fixture.root);
  const preset = await authored.readPresetDocument('default');
  await authored.writePresetDocument(
    'default',
    {
      ...preset.value,
      prompts: {
        system: 'Preset system',
        instructions: 'Preset instructions',
        postHistory: 'Preset post',
      },
    },
    preset.revision,
  );
  await authored.createBot('Utility');
  const document = await authored.readBotDocument('utility');
  const source = cardSchema.parse(document.value);
  assert.equal(source.spec, 'chara_card_v3');
  assert.deepEqual(await readdir(join(fixture.root, 'bots', 'utility')), [
    'utility.json',
  ]);
  await authored.writeBotDocument(
    'utility',
    {
      ...source,
      data: {
        ...source.data,
        system_prompt: 'Own system',
        post_history_instructions: '  ',
      },
    },
    document.revision,
  );
  let attempt = await authored.readAttempt('utility', 'default');
  assert.equal(attempt.writing.system_prompt, 'Own system');
  assert.equal(attempt.preset.prompts.instructions, 'Preset instructions');
  assert.equal(attempt.writing.post_history_instructions, 'Preset post');
  const ada = card('Ada');
  await authored.importBot({
    filename: 'Ada.json',
    data: Buffer.from(
      JSON.stringify({
        ...ada,
        data: {
          ...ada.data,
          nickname: 'A',
          system_prompt: '{{original}} plus Ada',
          post_history_instructions: '{{original}} after Ada',
        },
      }),
    ),
  });
  attempt = await authored.readAttempt('ada', 'default');
  assert.equal(attempt.writing.name, 'A');
  assert.equal(attempt.writing.system_prompt, 'Preset system plus Ada');
  assert.equal(
    attempt.writing.post_history_instructions,
    'Preset post after Ada',
  );
  assert.equal(attempt.preset.prompts.instructions, 'Preset instructions');
});

test('blank greeting swipes survive restart, select both ways, accept on first send, and stay out of model input, summary source, and search', async (t) => {
  const fixture = await createTestFixture();
  let closed = false;
  t.after(() => (closed ? undefined : fixture.runtime.close()));
  const authored = new AuthoredFiles(fixture.root);
  await authored.importBot({
    filename: 'Ada.json',
    data: Buffer.from(JSON.stringify(card('Ada', ' \n ', ['Opening', '']))),
  });
  const address = await listen(fixture.runtime);
  const response = await fetch(`${address}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ botSlug: 'ada' }),
  });
  assert.equal(response.status, 201);
  const created = (await response.json()) as { id: string };
  const before = fixture.runtime.storage.projection(created.id);
  const greeting = before.page.positions[0];
  assert.equal(greeting?.role, 'assistant');
  assert.equal(greeting.variantCount, 3);
  assert.equal(greeting.variant.source, '');
  assert.equal(
    fixture.runtime.storage.listSessions('ada')[0]?.title,
    'New conversation',
  );
  await fixture.runtime.close();
  closed = true;
  const reopened = await reopenTestFixture({
    root: fixture.root,
    faux: fixture.faux,
  });
  t.after(() => reopened.runtime.close());
  const nextAddress = await listen(reopened.runtime);
  const projection = async () =>
    (await (
      await fetch(`${nextAddress}/api/sessions/${created.id}`)
    ).json()) as SessionProjection;
  assert.equal((await projection()).page.positions[0]?.role, 'assistant');
  for (const direction of ['next', 'next', 'previous', 'previous']) {
    const selected: Response = await fetch(
      `${nextAddress}/api/sessions/${created.id}/positions/${greeting.id}/selection`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ direction }),
      },
    );
    assert.equal(selected.status, 200, await selected.text());
  }
  fixture.faux.setResponses([
    (context) => {
      assert.equal(
        context.messages.some((message) => message.role === 'assistant'),
        false,
      );
      return fauxAssistantMessage('Answer');
    },
  ]);
  await readEvents(
    await streamAttempt(nextAddress, created.id, {
      kind: 'reply',
      text: 'First user message',
    }),
  );
  const after = await projection();
  const opening = after.page.positions[0];
  assert.equal(opening?.role, 'assistant');
  assert.equal(opening.variant.source, '');
  assert.equal(opening.locked, true);
  const answer = after.page.positions.at(-1);
  assert.equal(answer?.role, 'assistant');
  assert.equal(answer.variant.source, 'Answer');
  assert.equal(
    reopened.runtime.storage.listSessions('ada')[0]?.title,
    'First user message',
  );
  const leaf = reopened.runtime.storage.createPendingLeaf({
    sessionId: created.id,
    liveTailExchanges: 1,
    now: new Date().toISOString(),
  });
  assert.equal(leaf, null); // An empty greeting alone creates no summary work.
  assert.deepEqual(
    searchHistory(
      reopened.runtime.storage.statements,
      created.id,
      'Opening',
      5,
    ),
    [],
  );
});
