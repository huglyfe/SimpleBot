import { expect, test, type Page } from '@playwright/test';
import { presetDocumentSchema } from '../shared/src/authored.js';
import {
  createSessionResponseSchema,
  sessionContextSchema,
  sessionProjectionSchema,
} from '../shared/src/contracts.js';

async function startConversation(page: Page, bot = 'Echo'): Promise<void> {
  const created = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/sessions' &&
      response.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: `New conversation with ${bot}` })
    .click();
  const { id } = createSessionResponseSchema.parse(
    await (await created).json(),
  );
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('simplebot-session')))
    .toBe(id);
  await expect(page.locator('.bot-identity')).toContainText(bot);
  await expect(page.locator('.msg-row')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeEnabled();
}

async function send(page: Page, text: string): Promise<void> {
  const message = page.getByRole('textbox', { name: 'Message' });
  await message.fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.msg-row.is-user').last()).toContainText(text);
  await expect(page.locator('.msg-row.is-assistant').last()).toContainText(
    /Acceptance reply/u,
  );
  await expect(message).toBeEnabled();
}

async function openConversationControls(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Conversation controls' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Conversation controls' }),
  ).toBeVisible();
}

/** Phones and touch input keep 16px entry (iOS focus zoom); desktop is compact. */
async function expectTextEntryFloor(page: Page): Promise<void> {
  const undersized = await page
    .locator('input, textarea, select')
    .evaluateAll((controls) =>
      controls.flatMap((control) => {
        const floor = matchMedia('(max-width: 800px), (pointer: coarse)')
          .matches
          ? 16
          : 14;
        const size = Number.parseFloat(getComputedStyle(control).fontSize);
        return size < floor
          ? [
              `${control.tagName.toLowerCase()}#${control.id || '(no id)'}: ${String(size)}px`,
            ]
          : [];
      }),
    );
  expect(undersized).toEqual([]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function botPng(name: string): Buffer {
  const card = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name,
      description: 'Imported through the final UI.',
      first_mes: 'Hello from the imported card.',
      system_prompt: '{{unsupported_macro}}',
      extension_field: { preserved: true },
    },
    top_level_extension: 'preserved',
  };
  const text = Buffer.from(
    `ccv3\0${Buffer.from(JSON.stringify(card)).toString('base64')}`,
    'latin1',
  );
  return Buffer.concat([
    pixel.subarray(0, -12),
    pngChunk('tEXt', text),
    pixel.subarray(-12),
  ]);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
});

test('runs the final conversation, swipe, search, and preset path', async ({
  page,
}) => {
  await startConversation(page);
  await send(page, 'Final browser acceptance turn');
  await page.getByLabel('Choose images').setInputFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: pixel,
  });
  await send(page, 'Final image attachment turn');
  await expect(
    page
      .locator('.msg-row.is-user')
      .last()
      .getByRole('img', { name: 'pixel.png' }),
  ).toBeVisible();

  const reply = page.locator('.msg-row.is-assistant').last();
  await reply.getByRole('button', { name: 'Generate another reply' }).click();
  await expect(page.getByText('2/2', { exact: true })).toBeVisible();

  // One search, in the drawer, over the message text of every conversation.
  // The bracketed term is the server snippet: a title match cannot produce it.
  const drawerSearch = page.getByRole('searchbox', {
    name: 'Search conversations',
  });
  await drawerSearch.fill('Final browser acceptance');
  await expect(page.getByText(/\[acceptance\]/u).first()).toBeVisible();
  await drawerSearch.fill('');

  await page.getByRole('button', { name: 'Preset settings' }).click();
  const preset = page.getByRole('dialog', { name: 'Preset settings' });
  await expect(preset.getByLabel('Name', { exact: true })).toHaveValue('User');
  await expect(
    preset.getByRole('button', { name: 'Main model', exact: true }),
  ).not.toHaveText('');
  await expectTextEntryFloor(page);
});

test('shows direct variable, schedule, Context, and compaction evidence', async ({
  page,
}) => {
  await startConversation(page);
  await send(page, 'Fallback evidence one');
  await send(page, 'Fallback evidence two');
  await send(page, 'Fallback evidence three');
  await openConversationControls(page);
  const conversation = page.getByRole('dialog', {
    name: 'Conversation controls',
  });

  await expect(
    conversation.getByRole('checkbox', { name: 'Automatic writes' }),
  ).toHaveCount(0);
  await expect(conversation.getByText('Context status')).toBeVisible();
  await expect(
    conversation.getByText('Last request tokens', { exact: true }),
  ).toBeVisible();
  await expect(
    conversation.getByText('Last message cost', { exact: true }),
  ).toBeVisible();
  await expect(
    conversation.getByText('Live tail', { exact: true }),
  ).toHaveCount(0);
  await expect(
    conversation.getByText('Compaction threshold', { exact: true }),
  ).toHaveCount(0);
  await expect(
    conversation.getByText('Current exchange', { exact: true }),
  ).toBeVisible();
  await expect(conversation.getByText(/^Exchange \d+$/u).first()).toBeVisible();
  await expect(conversation.getByText('Current assembly')).toHaveCount(0);

  await expect(conversation.getByLabel('Variable name')).toHaveCount(0);
  await conversation.getByRole('button', { name: 'Add variable' }).click();
  await page
    .getByRole('dialog', { name: 'Add variable', exact: true })
    .getByLabel('Variable name')
    .fill('mood');
  await page
    .getByRole('dialog', { name: 'Add variable', exact: true })
    .getByLabel('Value', { exact: true })
    .fill('steady');
  await page.getByRole('button', { name: 'Create variable' }).click();
  await expect(
    conversation.getByRole('button', { name: 'Edit variable mood' }),
  ).toContainText('steady');
  await expect(conversation.getByText(/by the operator/u)).toHaveCount(0);

  await conversation.getByRole('button', { name: 'Add schedule' }).click();
  await page.getByRole('button', { name: 'Create schedule' }).click();
  await expect(page.getByText(/Next run/u)).toBeVisible();

  await page.getByRole('button', { name: 'Compact now' }).click();
  await expect(
    page.getByText(/Fallback summary — model unavailable/u),
  ).toBeVisible();
  await expect(
    page.getByText('[Summary unavailable. Retrieve details if needed.]'),
  ).toBeVisible();
  const regenerate = conversation.getByRole('button', {
    name: /^Regenerate summary · Exchanges/u,
  });
  await regenerate.click();
  await expect(conversation.getByRole('alert')).toContainText(
    'Scripted summary failure.',
  );
  await expect(
    page.getByText('[Summary unavailable. Retrieve details if needed.]'),
  ).toBeVisible();
  const id = await page.evaluate(() =>
    localStorage.getItem('simplebot-session'),
  );
  const first = sessionProjectionSchema
    .parse(await (await page.request.get(`/api/sessions/${id ?? ''}`)).json())
    .page.positions.find(
      (position) =>
        position.role === 'user' && position.source === 'Fallback evidence one',
    );
  expect(
    (
      await page.request.patch(
        `/api/sessions/${id ?? ''}/positions/${first?.id ?? ''}/source`,
        { data: { source: 'Regenerated evidence one' } },
      )
    ).ok(),
  ).toBe(true);
  await regenerate.click();
  await expect(
    page.getByText('Summary regenerated from edited history.'),
  ).toBeVisible();
  await expect(conversation.getByRole('alert')).toHaveCount(0);
  await expect(
    page.getByText(/Fallback summary — model unavailable/u),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const summaryRow = conversation.getByRole('button', {
    name: /^Edit summary · Exchanges/u,
  });
  await summaryRow.click();
  const editor = page.getByRole('dialog', {
    name: /^Edit summary · Exchanges/u,
  });
  const summary = editor.getByRole('textbox', { name: 'Summary', exact: true });
  const source = 'The harbor conversation continues. '.repeat(120);
  await summary.fill(source);
  await summary.press('Escape');
  await expect(editor).toHaveCount(0);
  await summaryRow.click();
  await expect(summary).not.toHaveValue(source);
  await summary.fill(source);
  await expect(
    editor.getByRole('button', { name: 'Save summary' }),
  ).toBeInViewport();
  await editor.getByRole('button', { name: 'Save summary' }).click();
  await expect(summaryRow).toBeFocused();
  await page.reload();
  await openConversationControls(page);
  await page
    .getByRole('button', { name: /^Edit summary · Exchanges/u })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Summary', exact: true }),
  ).toHaveValue(source.trim());
  await page.getByRole('textbox', { name: 'Summary', exact: true }).fill('   ');
  await page.getByRole('button', { name: 'Save summary' }).click();
  await page.reload();
  await openConversationControls(page);
  await expect(summaryRow).toContainText('Empty summary');
  await expect(
    page.getByRole('button', { name: 'Compact now' }),
  ).toBeDisabled();
});

test('accepting the next reply triggers compaction without response state', async ({
  page,
}, testInfo) => {
  const slug = `acceptance-compaction-${String(testInfo.retry)}`;
  const preset = presetDocumentSchema.parse(
    await (await page.request.get('/api/presets/default')).json(),
  );
  preset.value.context.thresholdTokens = 1;
  preset.value.context.liveTailExchanges = 1;
  expect(
    (
      await page.request.put(`/api/presets/${slug}`, {
        data: { value: preset.value, expectedRevision: 'missing' },
      })
    ).ok(),
  ).toBe(true);
  const session = (await (
    await page.request.post('/api/sessions', {
      data: { botSlug: 'echo', presetSlug: slug },
    })
  ).json()) as { id: string };
  await page.evaluate(
    (id) => localStorage.setItem('simplebot-session', id),
    session.id,
  );
  await page.reload();
  await send(page, 'Slow compaction evidence one');
  await send(page, 'Slow compaction evidence two');
  const before = sessionContextSchema.parse(
    await (
      await page.request.get(`/api/sessions/${session.id}/context`)
    ).json(),
  );
  expect(before.leaves).toEqual([]);
  await expect(
    page.getByRole('list', { name: 'Response effects' }),
  ).toHaveCount(0);
  await send(page, 'Continue after accepting the response');
  await openConversationControls(page);
  await expect(
    page.getByText('Summary of the slow compaction evidence.'),
  ).toBeVisible();
});

test('keeps the current response swipable after manual compaction', async ({
  page,
}) => {
  await startConversation(page);
  await send(page, 'Slow compaction evidence one');
  await send(page, 'Slow compaction evidence two');
  await send(page, 'Slow compaction evidence three');
  await openConversationControls(page);
  const conversation = page.getByRole('dialog', {
    name: 'Conversation controls',
  });

  await conversation.getByRole('button', { name: 'Compact now' }).click();
  await expect(
    page.getByText('Summary of the slow compaction evidence.'),
  ).toBeVisible();
  await conversation.getByRole('button', { name: 'Close panel' }).click();
  await page
    .locator('.msg-row.is-assistant')
    .last()
    .getByRole('button', { name: 'Generate another reply' })
    .click();
  await expect(page.getByText('2/2', { exact: true })).toBeVisible();
});

test('imports bot artwork and shows editable source and owned grants', async ({
  page,
}, testInfo) => {
  const name = `Browser Card ${String(testInfo.retry + 1)}`;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const originalPreset = presetDocumentSchema.parse(
    await (await page.request.get('/api/presets/default')).json(),
  );
  expect(
    (
      await page.request.put('/api/presets/bot-layout', {
        data: { value: originalPreset.value, expectedRevision: 'missing' },
      })
    ).ok(),
  ).toBe(true);
  await page.getByRole('button', { name: 'New bot', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'New bot', exact: true });
  await create.getByLabel('Import card').setInputFiles({
    name: 'browser-card.png',
    mimeType: 'image/png',
    buffer: botPng(name),
  });

  await create.getByRole('button', { name: 'Create bot', exact: true }).click();
  const bot = page.getByRole('dialog', { name: 'Bot settings' });
  await expect(bot).toBeVisible();
  await expect(bot.getByLabel('Name', { exact: true })).toHaveValue(name);
  await expect(bot.locator('.bot-artwork-trigger img')).toBeVisible();
  const memory = bot.getByRole('combobox', { name: 'Memory server' });
  await memory.selectOption('');
  await expect(memory).toHaveValue('');
  const preset = bot.getByLabel('Default preset');
  await preset.click();
  await page
    .getByRole('group', { name: 'Default preset choices', exact: true })
    .getByRole('button', { name: /bot-layout/ })
    .click();
  await expect(preset).toContainText('bot-layout');
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await bot.getByLabel('Name', { exact: true }).scrollIntoViewIfNeeded();
    const art = await bot.locator('.bot-artwork-trigger').boundingBox();
    const field = await preset.boundingBox();
    if (!art || !field) throw new Error('Missing bot controls');
    const nameField = await bot
      .getByLabel('Name', { exact: true })
      .boundingBox();
    if (!nameField) throw new Error('Missing name');
    expect(nameField.x).toBeGreaterThanOrEqual(art.x + art.width);
    expect(field.y).toBeGreaterThanOrEqual(art.y + art.height);
    expect(field.x + field.width).toBeLessThanOrEqual(width);
    await expectTextEntryFloor(page);
  }
  expect(errors).toEqual([]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await bot.getByRole('button', { name: 'Edit System prompt' }).click();
  await expect(
    page.getByRole('textbox', { name: 'System prompt' }),
  ).toHaveValue('{{unsupported_macro}}');
  await page
    .getByRole('dialog', { name: 'Edit System prompt' })
    .getByRole('button', { name: 'Done' })
    .click();
  await bot.getByRole('button', { name: /^System/u }).click();
  await expect(
    bot.getByRole('checkbox', { name: /system__calculator/u }),
  ).not.toBeChecked();
  await bot.getByRole('button', { name: 'Add greeting' }).click();
  await page
    .getByRole('textbox', { name: 'Add greeting' })
    .fill('An alternate greeting.');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await bot.getByRole('button', { name: 'Remove greeting 2' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(
    bot.getByRole('button', { name: 'Edit Greeting 2', exact: true }),
  ).toHaveCount(0);
  await bot.getByRole('button', { name: 'Save', exact: true }).click();
  await bot.getByRole('button', { name: 'Close panel' }).click();
  await expect(
    page.getByRole('button', {
      name: `New conversation with ${name}`,
      exact: true,
    }),
  ).toBeVisible();
});

test.describe('touch viewport', () => {
  test.use({ hasTouch: true });

  test('keeps the final conversation and controls inside a phone viewport', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Open conversations' }).click();
    await startConversation(page);
    await send(page, 'Phone width acceptance turn');
    const message = page.getByRole('textbox', { name: 'Message', exact: true });
    await message.fill('Draft survives viewport resizing');
    // Exercise a shorter available viewport, not an emulated iOS keyboard.
    for (const height of [844, 420, 844]) {
      await page.setViewportSize({ width: 390, height });
      await message.focus();
      await expect(async () => {
        const bounds = await page.locator('.composer').boundingBox();
        if (!bounds) throw new Error('Composer missing');
        expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
        const bottomGap = height - bounds.y - bounds.height;
        expect(bottomGap).toBeCloseTo(4, 0);
      }).toPass();
      await expect(message).toHaveValue('Draft survives viewport resizing');
    }
    await message.blur();
    await expect(async () => {
      const bounds = await page.locator('.composer').boundingBox();
      if (!bounds) throw new Error('Composer missing');
      expect(844 - bounds.y - bounds.height).toBeCloseTo(16, 0);
    }).toPass();
    await page.getByRole('button', { name: 'Conversation controls' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Conversation controls' }),
    ).toHaveCSS('width', '390px');
    await expectTextEntryFloor(page);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBe(0);
  });
});

test('an admitted response completes after leaving and reopening the app', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await startConversation(page);
  await page
    .getByRole('textbox', { name: 'Message' })
    .fill('Acceptance background response');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.msg-row.is-user')).toContainText(
    'Acceptance background response',
  );
  await page.close();
  page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Stop response' }),
  ).toBeVisible();
  await expect(page.locator('.msg-row.is-assistant').last()).toContainText(
    'Finished in the background.',
    { timeout: 10_000 },
  );
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeEnabled();
  await page.reload();
  await expect(page.locator('.msg-row.is-assistant').last()).toContainText(
    'Finished in the background.',
  );
  await page
    .getByRole('textbox', { name: 'Message' })
    .fill('Acceptance background response, then stop');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.msg-row.is-user').last()).toContainText(
    'then stop',
  );
  await page.reload();
  await page.getByRole('button', { name: 'Stop response' }).click();
  await expect(page.locator('.msg-row.is-assistant').last()).toContainText(
    'Generation stopped by operator.',
    { timeout: 10_000 },
  );
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(
    0,
  );
  expect(errors).toEqual([]);
});

test('a failed refresh retains the loaded conversation and composer', async ({
  page,
}) => {
  await page.goto('/');
  await startConversation(page);
  const navigationRefresh = page.waitForResponse('**/api/bootstrap');
  await send(page, 'Keep this conversation visible.');
  await navigationRefresh;
  await page.route('**/api/bootstrap', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Scripted navigation refresh failure' }),
    });
  });
  await page.route('**/api/sessions/*', async (route) => {
    if (route.request().method() === 'GET')
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Scripted refresh failure' }),
      });
    else await route.continue();
  });
  await page
    .getByRole('textbox', { name: 'Message' })
    .fill('Another response.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(
    page
      .getByRole('alertdialog')
      .filter({ hasText: 'Scripted refresh failure' }),
  ).toBeVisible();
  // A failed session refresh stops before bootstrap invalidation. Returning
  // after the bootstrap cache is stale independently refreshes that query.
  await page.clock.install();
  await page.clock.fastForward(10_000);
  await page.evaluate(() =>
    window.dispatchEvent(new Event('visibilitychange')),
  );
  await expect(
    page
      .getByRole('alertdialog')
      .filter({ hasText: 'Scripted navigation refresh failure' }),
  ).toBeVisible();
  await expect(page.locator('.msg-row.is-user').first()).toContainText(
    'Keep this conversation visible.',
  );
  await expect(page.locator('.msg-row.is-assistant').first()).toContainText(
    'Acceptance reply',
  );
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(
    0,
  );
  await page.unroute('**/api/bootstrap');
  await page.unroute('**/api/sessions/*');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.locator('.msg-row.is-user').last()).toContainText(
    'Another response.',
  );
});

test('reopening after more than a page of background turns keeps every message reachable', async ({
  page,
}) => {
  await startConversation(page);
  await send(page, 'History before leaving');
  const sessionId = await page.evaluate(() =>
    localStorage.getItem('simplebot-session'),
  );
  if (sessionId === null) throw new Error('Conversation was not selected');
  await startConversation(page, 'Help');
  for (let index = 0; index < 30; index += 1) {
    const response = await page.request.post(
      `/api/sessions/${sessionId}/attempts`,
      {
        data: { kind: 'reply', text: `Background history ${String(index)}` },
      },
    );
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain('"type":"completed"');
  }
  await page.clock.setFixedTime(new Date(Date.now() + 6_000));
  await page
    .getByRole('button', { name: 'History before leaving', exact: true })
    .click();
  await expect(page.locator('.msg-row.is-user').last()).toContainText(
    'Background history 29',
  );
  await page.getByRole('button', { name: 'Load earlier messages' }).click();
  await expect(page.locator('.msg-row')).toHaveCount(62);
  await expect(page.locator('.msg-row.is-user .msg-plain')).toHaveText([
    'History before leaving',
    ...Array.from(
      { length: 30 },
      (_, index) => `Background history ${String(index)}`,
    ),
  ]);
  await expect(
    page.getByRole('button', { name: 'Load earlier messages' }),
  ).toHaveCount(0);
});

test('history hides swipes and return waits for two transcript heights after resizing', async ({
  page,
}) => {
  await page.goto('/');
  await startConversation(page);
  for (let turn = 0; turn < 3; turn++) {
    await send(
      page,
      Array.from(
        { length: 40 },
        (_, line) =>
          `Turn ${String(turn)}, line ${String(line)}: reading older conversation history.`,
      ).join('\n\n'),
    );
  }
  await expect(
    page.getByRole('group', { name: 'Response variants' }),
  ).toHaveCount(1);
  const scroll = page.locator('.msg-scroll');
  const returnButton = page.getByRole('button', { name: 'Return to latest' });
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
    { width: 390, height: 500 },
  ]) {
    await page.setViewportSize(viewport);
    await scroll.evaluate(async (element) => {
      element.scrollTop = element.scrollHeight;
      // Finish the response's queued follow frame and resize observers before
      // simulating a separate scroll gesture.
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
    await expect(returnButton).toBeHidden();
    await scroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight - element.clientHeight * 3.5;
    });
    await expect(returnButton).toBeVisible();
    await scroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight - element.clientHeight * 2.5;
    });
    await expect(returnButton).toBeHidden();
    await scroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight - element.clientHeight * 3.5;
    });
    await returnButton.click();
    await expect
      .poll(() =>
        scroll.evaluate(
          (element) =>
            element.scrollHeight - element.clientHeight - element.scrollTop,
        ),
      )
      .toBeLessThan(2);
    await expect(returnButton).toBeHidden();
    await expect(page.locator('.msg-row.is-assistant').last()).toBeInViewport();
  }
});

for (const width of [1280, 390]) {
  test(`accepted changes collapse and remain inspectable at ${String(width)}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    if (width === 390)
      await page.getByRole('button', { name: 'Open conversations' }).click();
    await startConversation(page);
    await send(page, `Acceptance todo effects ${String(width)}`);
    const response = page.locator('.msg-row.is-assistant').last();
    await expect(
      response.getByRole('list', { name: 'Response effects' }),
    ).toContainText('Model deadline');
    await response.getByRole('button', { name: 'Apply effects' }).click();
    const summary = response.getByRole('button', {
      name: /2 changes applied/u,
    });
    await expect(summary).toHaveAttribute('aria-expanded', 'false');
    await expect(
      response.getByRole('list', { name: 'Response effects' }),
    ).toBeHidden();
    await summary.click();
    await expect(
      response.getByRole('list', { name: 'Response effects' }),
    ).toContainText('2026-10-23T15:45');
    await page.reload();
    await expect(
      page.getByRole('button', { name: /2 changes applied/u }),
    ).toHaveAttribute('aria-expanded', 'false');
    await openConversationControls(page);
    await expect(
      page.getByRole('button', {
        name: 'Edit to-do Model deadline',
        exact: true,
      }),
    ).toBeVisible();
  });
}
