import assert from 'node:assert/strict';
import { chmod, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  botArtworkResponseSchema,
  authoredDocumentSchema,
  type Bootstrap,
  type BotImportResponse,
} from '@simplebot/shared';

import {
  disposeTestFixture,
  createTestFixture,
  listen,
  reopenTestFixture,
} from './test-helper.js';

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test('V3 PNG import wins over V2 and preserves source, artwork, and unknown fields', async (context) => {
  const fixture = await createTestFixture({
    clock: () => new Date('2026-08-23T14:30:00.000Z'),
  });
  context.after(() => disposeTestFixture(fixture));
  const address = await listen(fixture.runtime);
  const v2 = card('Ignored V2', 'chara_card_v2', '2.0');
  const v3 = {
    ...card('Imported Hero', 'chara_card_v3', '3.0'),
    vendor_extension: { retained: true },
    data: {
      ...card('Imported Hero', 'chara_card_v3', '3.0').data,
      description: 'Hello {{user}}. {{setvar::mood::bright}}',
      future_field: ['keep', 7],
    },
  };
  const png = botPng([
    ['chara', v2],
    ['ccv3', v3],
  ]);

  const response = await fetch(`${address}/api/bots/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      filename: 'hero.png',
      name: 'Chosen Hero',
      data: png.toString('base64'),
    }),
  });
  const responseText = await response.text();
  assert.equal(response.status, 201, responseText);
  const imported = JSON.parse(responseText) as BotImportResponse;
  assert.equal(imported.slug, 'chosen-hero');
  assert.equal(imported.name, 'Chosen Hero');
  assert.match(
    imported.avatarUrl ?? '',
    /^\/api\/bots\/chosen-hero\/avatar\?v=/u,
  );

  const directory = join(fixture.root, 'bots', imported.slug);
  const stored = JSON.parse(
    await readFile(join(directory, 'chosen-hero.json'), 'utf8'),
  ) as Record<string, unknown>;
  assert.deepEqual(stored, {
    ...v3,
    data: {
      ...v3.data,
      name: 'Chosen Hero',
      extensions: { simplebot: { defaultPreset: 'default' } },
    },
  });
  assert.deepEqual(await readFile(join(directory, 'icon.png')), png);
  await assert.rejects(stat(join(directory, 'config.json')), /ENOENT/u);

  const bootstrap = (await (
    await fetch(`${address}/api/bootstrap`)
  ).json()) as Bootstrap;
  assert.equal(
    bootstrap.bots.find(({ slug }) => slug === imported.slug)?.name,
    'Chosen Hero',
  );
});

test('V2 PNG import works and malformed or colliding imports create nothing', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const address = await listen(fixture.runtime);
  const v2Png = botPng([['chara', card('V Two', 'chara_card_v2', '2.0')]]);
  const imported = await importPng(address, 'v2.png', v2Png);
  assert.equal(imported.status, 201, await imported.text());

  const collision = await importPng(address, 'again.png', v2Png);
  assert.equal(collision.status, 409);
  assert.match(await collision.text(), /Bot v-two already exists/u);

  const corrupt = Buffer.from(
    botPng([['chara', card('Broken', 'chara_card_v2', '2.0')]]),
  );
  corrupt[corrupt.length - 1] = (corrupt.at(-1) ?? 0) ^ 0xff;
  const rejected = await importPng(address, 'broken.png', corrupt);
  assert.equal(rejected.status, 400);
  assert.match(await rejected.text(), /invalid checksum/u);
  await assert.rejects(stat(join(fixture.root, 'bots', 'broken')), /ENOENT/u);
});

test('artwork replacement is independent of card revisions, ignores embedded settings, and survives restart', async (context) => {
  const fixture = await createTestFixture();
  let runtime = fixture.runtime;
  context.after(() => runtime.close());
  const original = authoredDocumentSchema.parse(
    (await runtime.app.inject('/api/bots/echo')).json(),
  );
  const replace = async (data: Buffer) =>
    runtime.app.inject({
      method: 'PUT',
      url: '/api/bots/echo/avatar',
      payload: { data: data.toString('base64') },
    });
  const added = await replace(PIXEL_PNG);
  assert.equal(added.statusCode, 200, added.body);
  const firstUrl = botArtworkResponseSchema.parse(added.json()).avatarUrl;
  const png = botPng([
    ['ccv3', card('Do not import me', 'chara_card_v3', '3.0')],
  ]);
  const replaced = await replace(png);
  assert.equal(replaced.statusCode, 200, replaced.body);
  const { avatarUrl } = botArtworkResponseSchema.parse(replaced.json());
  assert.notEqual(avatarUrl, firstUrl);
  assert.deepEqual(
    (await runtime.app.inject('/api/bots/echo')).json(),
    original,
  );
  assert.deepEqual((await runtime.app.inject(avatarUrl)).rawPayload, png);
  // A draft opened before image replacement still saves with its original revision.
  const saved = await runtime.app.inject({
    method: 'PUT',
    url: '/api/bots/echo',
    payload: {
      expectedRevision: original.revision,
      value: original.value,
    },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  await runtime.close();
  runtime = (await reopenTestFixture(fixture)).runtime;
  assert.deepEqual((await runtime.app.inject(avatarUrl)).rawPayload, png);
  const bootstrap = (
    await runtime.app.inject('/api/bootstrap')
  ).json<Bootstrap>();
  assert.equal(
    bootstrap.bots.find((bot) => bot.slug === 'echo')?.avatarUrl,
    avatarUrl,
  );
});

test('invalid or failed image replacements preserve saved artwork and card source', async (context) => {
  const fixture = await createTestFixture();
  context.after(() => disposeTestFixture(fixture));
  const app = fixture.runtime.app;
  const upload = (data: string, bot = 'echo') =>
    app.inject({
      method: 'PUT',
      url: `/api/bots/${bot}/avatar`,
      payload: { data },
    });
  assert.equal((await upload(PIXEL_PNG.toString('base64'))).statusCode, 200);
  const original = (await app.inject('/api/bots/echo')).body;
  const corrupt = Buffer.from(PIXEL_PNG);
  corrupt[corrupt.length - 1] = 0xff;
  const header = Buffer.from(PIXEL_PNG.subarray(16, 29));
  header.writeUInt32BE(8193, 0);
  const tooWide = Buffer.concat([
    PIXEL_PNG.subarray(0, 8),
    pngChunk('IHDR', header),
    PIXEL_PNG.subarray(33),
  ]);
  for (const data of [
    '',
    '???',
    Buffer.from('not a PNG').toString('base64'),
    corrupt.toString('base64'),
    tooWide.toString('base64'),
    Buffer.alloc(10_000_001).toString('base64'),
  ]) {
    assert.equal((await upload(data)).statusCode, 400);
    assert.deepEqual(
      (await app.inject('/api/bots/echo/avatar')).rawPayload,
      PIXEL_PNG,
    );
    assert.equal((await app.inject('/api/bots/echo')).body, original);
  }
  assert.equal((await upload('A'.repeat(14_000_000))).statusCode, 413);
  assert.equal(
    (await upload(PIXEL_PNG.toString('base64'), 'missing')).statusCode,
    400,
  );
  await assert.rejects(stat(join(fixture.root, 'bots', 'missing')), /ENOENT/u);
  // Fail at the actual file-write boundary, then restore the disposable folder.
  if (process.platform !== 'win32' && process.getuid?.() !== 0) {
    const folder = join(fixture.root, 'bots', 'echo');
    await chmod(folder, 0o500);
    try {
      assert.equal(
        (await upload(PIXEL_PNG.toString('base64'))).statusCode,
        500,
      );
    } finally {
      await chmod(folder, 0o700);
    }
    assert.deepEqual(
      (await app.inject('/api/bots/echo/avatar')).rawPayload,
      PIXEL_PNG,
    );
    assert.equal(
      (await readdir(folder)).some((name) => name.endsWith('.tmp')),
      false,
    );
  }
});

test('artwork writes require the same authenticated boundary as card edits', async (context) => {
  const fixture = await createTestFixture({ loginEnabled: true });
  context.after(() => disposeTestFixture(fixture));
  const result = await fixture.runtime.app.inject({
    method: 'PUT',
    url: '/api/bots/echo/avatar',
    payload: { data: PIXEL_PNG.toString('base64') },
  });
  assert.equal(result.statusCode, 401);
  await assert.rejects(
    stat(join(fixture.root, 'bots', 'echo', 'icon.png')),
    /ENOENT/u,
  );
});

function card(name: string, spec: string, specVersion: string) {
  return {
    spec,
    spec_version: specVersion,
    data: {
      name,
      description: '',
      personality: '',
      scenario: '',
      mes_example: '',
      system_prompt: 'Stay concise.',
      post_history_instructions: '',
      first_mes: 'Hello.',
      alternate_greetings: [],
    },
  };
}

async function importPng(address: string, filename: string, png: Buffer) {
  return fetch(`${address}/api/bots/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filename, data: png.toString('base64') }),
  });
}

function botPng(chunks: readonly [string, unknown][]): Buffer {
  const iendOffset = PIXEL_PNG.length - 12;
  return Buffer.concat([
    PIXEL_PNG.subarray(0, iendOffset),
    ...chunks.map(([keyword, value]) => {
      const payload = Buffer.from(JSON.stringify(value), 'utf8').toString(
        'base64',
      );
      return pngChunk(
        'tEXt',
        Buffer.concat([
          Buffer.from(keyword, 'latin1'),
          Buffer.from([0]),
          Buffer.from(payload, 'latin1'),
        ]),
      );
    }),
    PIXEL_PNG.subarray(iendOffset),
  ]);
}

function pngChunk(type: string, content: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + content.length);
  chunk.writeUInt32BE(content.length, 0);
  name.copy(chunk, 4);
  content.copy(chunk, 8);
  chunk.writeUInt32BE(
    crc32(Buffer.concat([name, content])),
    8 + content.length,
  );
  return chunk;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
