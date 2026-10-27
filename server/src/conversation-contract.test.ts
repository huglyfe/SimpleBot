import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import {
  sessionChangeSchema,
  sessionProjectionSchema,
  transcriptPageSchema,
  type Bootstrap,
  type PresetList,
  type ProviderList,
  type ProviderModels,
  type SessionChange,
  type SessionProjection,
} from '@simplebot/shared';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { AuthoredFiles, AuthoredValidationError } from './authored.js';
import { GREETING_MODEL, GREETING_PROVIDER } from './storage.js';
import {
  disposeTestFixture,
  createSession,
  createTestFixture,
  listen,
  readEvents,
  seedExchange,
  streamAttempt,
} from './test-helper.js';

test('transcript pages preserve the complete ordered history and reject malformed bounds', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const app = fixture.runtime.app;
  const created = await app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: { botSlug: 'echo' },
  });
  const { id } = created.json<{ id: string }>();
  for (let index = 0; index < 60; index += 1) {
    seedExchange(fixture, {
      sessionId: id,
      user: `Message ${String(index)}`,
      assistant: `Reply ${String(index)}`,
      now: '2026-09-13T12:00:00.000Z',
    });
  }
  const response = await app.inject(`/api/sessions/${id}`);
  let page = sessionProjectionSchema.parse(response.json()).page;
  const ordinals = page.positions.map((position) => position.ordinal);
  assert.equal(page.positions.length, 50);
  while (page.hasMore) {
    const first = page.positions[0];
    assert.ok(first);
    const earlier = await app.inject(
      `/api/sessions/${id}/positions?before=${String(first.ordinal)}`,
    );
    assert.equal(earlier.statusCode, 200);
    page = transcriptPageSchema.parse(earlier.json());
    assert.ok(page.positions.length <= 50);
    ordinals.unshift(...page.positions.map((position) => position.ordinal));
  }
  assert.deepEqual(
    ordinals,
    Array.from({ length: 120 }, (_, index) => index),
  );
  for (const before of ['10junk', '1.5', '-1', '', '9007199254740992']) {
    const invalid = await app.inject(
      `/api/sessions/${id}/positions?before=${before}`,
    );
    assert.equal(invalid.statusCode, 409, before);
  }
});

test('a new session seeds the card greeting as position 0 with its alternates as swipes', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  await writeGreetings(fixture.root, 'Hello there.', [
    'A second opening.',
    'A third opening.',
  ]);
  const address = await listen(fixture.runtime);
  const sessionId = await createSession(address);

  const seeded = await projection(address, sessionId);
  assert.equal(seeded.positions.length, 1);
  const greeting = seeded.positions[0];
  assert.equal(greeting?.role, 'assistant');
  assert.equal(greeting.ordinal, 0);
  assert.equal(greeting.locked, false);
  // The payload carries the selected greeting alone, plus a count of the
  // alternates it stands in for.
  assert.equal(greeting.variant.source, 'Hello there.');
  assert.equal(greeting.variant.ordinal, 1);
  assert.equal(greeting.variantIndex, 0);
  assert.equal(greeting.variantCount, 3);
  assert.equal(greeting.variant.provider, GREETING_PROVIDER);
  assert.equal(greeting.variant.model, GREETING_MODEL);
  assert.deepEqual(greeting.variant.trace, []);

  // The alternates are ordinary swipes at the same position, reached by
  // stepping the selection rather than by naming a sibling the client never
  // received.
  await mutate(
    address,
    `/api/sessions/${sessionId}/positions/${greeting.id}/selection`,
    'PATCH',
    { direction: 'next' },
  );
  const selected = await mutate(
    address,
    `/api/sessions/${sessionId}/positions/${greeting.id}/selection`,
    'PATCH',
    { direction: 'next' },
  );
  const reselected = selected.positions[0];
  if (reselected?.role !== 'assistant') throw new Error('Missing greeting');
  assert.equal(reselected.variant.source, 'A third opening.');
  assert.equal(reselected.variantIndex, 2);
  assert.equal(reselected.variantCount, 3);

  // The selected greeting is the transcript the first reply builds on, and
  // that reply accepts the position through the ordinary acceptance boundary.
  fixture.faux.setResponses([
    (providerContext) => {
      assert.deepEqual(
        providerContext.messages.map((message) => message.role),
        ['system', 'assistant', 'user'],
      );
      const opening = providerContext.messages[1];
      assert.equal(opening?.role, 'assistant');
      assert.equal(
        opening.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join(''),
        'A third opening.',
      );
      return fauxAssistantMessage('Replying.');
    },
  ]);
  await readEvents(
    await streamAttempt(address, sessionId, { kind: 'reply', text: 'Hi.' }),
  );

  const answered = await projection(address, sessionId);
  const locked = answered.positions[0];
  if (locked?.role !== 'assistant') throw new Error('Missing greeting');
  assert.equal(locked.locked, true);
  assert.deepEqual(
    answered.positions.map((position: { ordinal: number }) => position.ordinal),
    [0, 1, 2],
  );
});

test('a bot without a greeting starts empty', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const address = await listen(fixture.runtime);

  assert.deepEqual(
    (await projection(address, await createSession(address))).positions,
    [],
  );
});

test('bot artwork is served from the card folder and absent artwork is a 404', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  await writeFile(join(fixture.root, 'bots', 'echo', 'icon.png'), PIXEL_PNG);
  const address = await listen(fixture.runtime);

  const found = await fetch(`${address}/api/bots/echo/avatar`);
  assert.equal(found.status, 200);
  assert.equal(found.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await found.arrayBuffer()), PIXEL_PNG);

  const missing = await fetch(`${address}/api/bots/help/avatar`);
  assert.equal(missing.status, 404);

  const bootstrap = (await (
    await fetch(`${address}/api/bootstrap`)
  ).json()) as Bootstrap;
  assert.match(
    bootstrap.bots.find((entry) => entry.slug === 'echo')?.avatarUrl ?? '',
    /^\/api\/bots\/echo\/avatar\?v=/u,
  );
  assert.equal(
    bootstrap.bots.find((entry) => entry.slug === 'help')?.avatarUrl,
    null,
  );
});

test('authored validation failures name the file, the field, and the expectation', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const path = join(fixture.root, 'presets', 'default.json');
  const preset = JSON.parse(await readFile(path, 'utf8')) as Record<
    string,
    unknown
  >;
  await writeFile(
    path,
    JSON.stringify({ ...preset, tts: { model: 'kokoro', format: 'mp3' } }),
  );

  await assert.rejects(
    new AuthoredFiles(fixture.root).readPresetDocument('default'),
    (error: unknown) => {
      assert.ok(error instanceof AuthoredValidationError);
      assert.match(error.message, /presets[/\\]default\.json is not valid/u);
      assert.match(error.message, /tts\.voice/u);
      return true;
    },
  );

  await writeFile(path, '{ not json');
  await assert.rejects(
    new AuthoredFiles(fixture.root).readPresetDocument('default'),
    /presets[/\\]default\.json is not valid JSON/u,
  );
});

test('a missing required authored file is reported by path, not by errno', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const authored = new AuthoredFiles(fixture.root);

  await assert.rejects(
    authored.readGreetings('absent'),
    /bots[/\\]absent.*required but missing/u,
  );
});

test('a fresh faux provider keeps greeting provenance out of provider identity', async (context) => {
  const faux = fauxProvider({ provider: 'contract-faux' });
  const fixture = await createTestFixture({ faux });
  context.after(() => disposeTestFixture(fixture));
  await writeGreetings(fixture.root, 'Authored opening.', []);
  const address = await listen(fixture.runtime);
  const sessionId = await createSession(address);

  const greeting = (await projection(address, sessionId)).positions[0];
  if (greeting?.role !== 'assistant') throw new Error('Missing greeting');
  assert.notEqual(greeting.variant.provider, faux.provider.id);
  assert.equal(greeting.variant.provider, GREETING_PROVIDER);
});

test('presets on disk are enumerable and an unparseable one is omitted', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const source = await readFile(
    join(fixture.root, 'presets', 'default.json'),
    'utf8',
  );
  await writeFile(join(fixture.root, 'presets', 'second.json'), source);
  // A preset that cannot be parsed is not offered: the picker lists what can
  // actually be selected, and opening it would fail with its own message.
  await writeFile(join(fixture.root, 'presets', 'broken.json'), '{ nope');
  const address = await listen(fixture.runtime);

  const body = (await (
    await fetch(`${address}/api/presets`)
  ).json()) as PresetList;
  assert.deepEqual(
    body.presets.map((preset) => preset.slug),
    ['default', 'second'],
  );
  assert.equal(body.presets[0]?.model, fixture.faux.getModel().id);
});

test('the provider catalog lists providers and their models', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const address = await listen(fixture.runtime);
  const providerId = fixture.faux.provider.id;

  const providers = (await (
    await fetch(`${address}/api/providers`)
  ).json()) as ProviderList;
  const entry = providers.providers.find((item) => item.id === providerId);
  assert.ok(entry, 'the configured provider is listed');

  const models = (await (
    await fetch(
      `${address}/api/providers/${encodeURIComponent(providerId)}/models`,
    )
  ).json()) as ProviderModels;
  assert.equal(models.error, null);
  assert.ok(
    models.models.some((model) => model.id === fixture.faux.getModel().id),
    "the provider's own model is offered",
  );

  const unknown = await fetch(`${address}/api/providers/not-a-provider/models`);
  assert.equal(unknown.status, 404);
});

test('long transcripts keep ordered attachments and effects on their own positions', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const storage = fixture.runtime.storage;
  const sessionId = randomUUID();
  const now = '2026-09-17T00:00:00.000Z';
  storage.createSession({
    id: sessionId,
    botSlug: 'echo',
    presetSlug: 'default',
    now,
  });
  for (let turn = 0; turn < 75; turn++) {
    const source = String(turn);
    const attachment = await storage.importAttachment({
      sessionId,
      filename: `${source}.png`,
      data: PIXEL_PNG,
      maxDimension: 10,
      now,
    });
    seedExchange(fixture, {
      sessionId,
      user: source,
      assistant: source,
      now,
      attachmentIds: [attachment.id],
      effects: [
        { type: 'variable_set', arguments: { name: 'first', value: source } },
        { type: 'variable_set', arguments: { name: 'second', value: source } },
      ],
    });
  }
  const loaded = storage.loadSession(sessionId, 5);
  assert.ok(loaded);
  assert.equal(loaded.positions.length, 150);
  for (const position of loaded.positions) {
    if (position.role === 'assistant') {
      assert.equal('trace' in position.variant, false);
      assert.equal('effects' in position.variant, false);
      assert.equal('variantCount' in position, false);
    }
  }
  const projection = sessionProjectionSchema.parse(
    (await fixture.runtime.app.inject(`/api/sessions/${sessionId}`)).json(),
  );
  assert.equal(projection.page.positions.length, 50);
  assert.equal(projection.page.hasMore, true);
  for (const position of [...loaded.positions, ...projection.page.positions]) {
    if (position.role === 'user') {
      assert.deepEqual(
        position.attachments.map((item) => item.filename),
        [`${position.source}.png`],
      );
    }
  }
  for (const position of projection.page.positions) {
    if (position.role === 'assistant') {
      assert.deepEqual(
        position.variant.effects.map((effect) => effect.arguments),
        [
          { name: 'first', value: position.variant.source },
          { name: 'second', value: position.variant.source },
        ],
      );
    }
  }
});

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

async function writeGreetings(
  root: string,
  first: string,
  alternates: readonly string[],
): Promise<void> {
  const path = join(root, 'bots', 'echo', 'echo.json');
  const card = JSON.parse(await readFile(path, 'utf8')) as {
    data: Record<string, unknown>;
  };
  card.data.first_mes = first;
  card.data.alternate_greetings = [...alternates];
  await writeFile(path, JSON.stringify(card));
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
