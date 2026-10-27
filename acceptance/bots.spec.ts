import {
  authoredDocumentSchema,
  createSessionResponseSchema,
} from '../shared/src/contracts.js';
import { expect, test } from '@playwright/test';

test('creates and edits a bot, starts empty, sends and reopens its first conversation', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page).toHaveTitle(/SimpleBot/u);
  const drawer = page.getByRole('button', {
    name: 'Open conversations',
    exact: true,
  });
  if (await drawer.isVisible()) await drawer.click();
  await page.getByRole('button', { name: 'New bot', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'New bot', exact: true });
  await create.getByLabel('Bot name').fill('Browser Utility');
  await create.getByRole('button', { name: 'Create bot', exact: true }).click();
  const bot = page.getByRole('dialog', { name: 'Bot settings', exact: true });
  await expect(bot.getByLabel('Name', { exact: true })).toHaveValue(
    'Browser Utility',
  );
  await expect(
    bot.getByRole('heading', { name: 'Writing', exact: true }),
  ).toBeVisible();
  await expect(
    bot.getByRole('button', { name: 'Edit Description', exact: true }),
  ).toBeVisible();
  await expect(
    bot.getByRole('button', { name: 'Edit Greeting 1', exact: true }),
  ).toHaveCount(0);
  await bot
    .getByRole('button', { name: 'Edit System prompt', exact: true })
    .click();
  const instructions = page.getByRole('dialog', {
    name: 'Edit System prompt',
    exact: true,
  });
  await instructions
    .getByLabel('System prompt', { exact: true })
    .fill('Help me keep things simple.');
  await instructions.getByRole('button', { name: 'Done', exact: true }).click();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.screenshot({
      animations: 'disabled',
      path: `/tmp/simplebot-created-${String(width)}.png`,
    });
  }
  await bot.getByRole('button', { name: 'Save', exact: true }).click();
  await bot.getByRole('button', { name: 'Close panel', exact: true }).click();
  if (await drawer.isVisible()) await drawer.click();
  const created = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/sessions' &&
      response.request().method() === 'POST',
  );
  await page
    .getByRole('button', {
      name: 'New conversation with Browser Utility',
      exact: true,
    })
    .click();
  const { id } = createSessionResponseSchema.parse(
    await (await created).json(),
  );
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('simplebot-session')))
    .toBe(id);
  await expect(page.locator('.msg-row')).toHaveCount(0);
  const message = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(message).toBeEnabled();
  await message.fill('A first bot message');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.msg-row.is-assistant')).toHaveCount(1);
  await expect(message).toBeEmpty();
  await page.reload();
  await expect(
    page.getByText('A first bot message', { exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator('.msg-row.is-assistant')).toHaveCount(1);
  expect(errors).toEqual([]);
});

for (const width of [1280, 390]) {
  test(`imports a card and edits its owned settings at ${String(width)}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    const drawer = page.getByRole('button', {
      name: 'Open conversations',
      exact: true,
    });
    if (width === 390) await drawer.click();
    const source = {
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: `Browser Card ${String(width)}`,
        first_mes: 'First opening',
        alternate_greetings: ['', 'Last opening'],
        description: 'A synthetic test card.',
        extensions: {
          untouched: { keep: true },
          simplebot: {
            defaultPreset: 'default',
            capabilities: [{ kind: 'tool', name: 'mcp__unavailable__read' }],
          },
        },
      },
    };
    await page.getByRole('button', { name: 'New bot', exact: true }).click();
    const create = page.getByRole('dialog', { name: 'New bot', exact: true });
    const picker = page.waitForEvent('filechooser');
    await create.getByRole('button', { name: 'Import card' }).click();
    await (
      await picker
    ).setFiles({
      name: 'Browser Card.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(source)),
    });
    await expect(create.getByLabel('Bot name')).toBeVisible();
    if (width === 390)
      await create.getByLabel('Bot name').fill('Chosen Card 390');
    if (width === 1280) {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(create.getByText('Browser Card.json')).toBeVisible();
      await page.setViewportSize({ width, height: 844 });
    }
    await page.screenshot({
      animations: 'disabled',
      path: `/tmp/simplebot-new-bot-${String(width)}.png`,
    });
    await create
      .getByRole('button', { name: 'Create bot', exact: true })
      .click();
    const bot = page.getByRole('dialog', { name: 'Bot settings', exact: true });
    await expect(
      bot.getByRole('button', { name: 'Edit Description', exact: true }),
    ).toBeVisible();
    await expect(
      bot.getByRole('button', { name: 'Edit Instructions', exact: true }),
    ).toHaveCount(0);
    await expect(
      bot.getByText('mcp__unavailable__read', { exact: true }),
    ).toBeVisible();
    for (let index = 0; index < 3; index++) {
      await bot
        .getByRole('button', { name: 'Remove greeting 1', exact: true })
        .click();
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
    }
    await expect(
      bot.getByRole('button', { name: 'Edit Greeting 1', exact: true }),
    ).toHaveCount(0);
    await bot.getByRole('button', { name: 'Save', exact: true }).click();
    const saved = authoredDocumentSchema.parse(
      await (
        await page.request.get(
          width === 390
            ? '/api/bots/chosen-card-390'
            : '/api/bots/browser-card-1280',
        )
      ).json(),
    );
    expect(saved.value).toEqual({
      ...source,
      data: {
        ...source.data,
        name: width === 390 ? 'Chosen Card 390' : source.data.name,
        first_mes: '',
        alternate_greetings: [],
      },
    });
    await page.screenshot({ path: `/tmp/simplebot-card-${String(width)}.png` });
  });
}

test('bot image changes save immediately across the panel, header, drawer, and reload while text stays a draft', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page).toHaveTitle(/SimpleBot/u);
  const drawer = page.getByRole('button', {
    name: 'Open conversations',
    exact: true,
  });
  if (await drawer.isVisible()) await drawer.click();
  await page
    .getByRole('button', { name: 'New conversation with Echo', exact: true })
    .click();
  await expect(page.locator('.bot-identity')).toContainText('Echo');
  await page.locator('.bot-identity').click();
  const panel = page.getByRole('dialog', { name: 'Bot settings', exact: true });
  const original = authoredDocumentSchema.parse(
    await (await page.request.get('/api/bots/echo')).json(),
  );
  await panel.getByLabel('Name', { exact: true }).fill('Unsaved name');
  const png = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 240;
      canvas.height = 320;
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('Canvas unavailable');
      context.fillStyle = '#344e68';
      context.fillRect(0, 0, 240, 320);
      context.fillStyle = '#f4b860';
      context.beginPath();
      context.arc(120, 140, 70, 0, Math.PI * 2);
      context.fill();
      return canvas.toDataURL('image/png').split(',')[1] ?? '';
    }),
    'base64',
  );
  const uploaded = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/bots/echo/avatar' &&
      response.request().method() === 'PUT',
  );
  const picker = page.waitForEvent('filechooser');
  await panel.getByRole('button', { name: 'Add image', exact: true }).click();
  await (
    await picker
  ).setFiles({
    name: 'portrait.png',
    mimeType: 'image/png',
    buffer: png,
  });
  const response = await uploaded;
  expect(response.ok()).toBe(true);
  const { avatarUrl } = (await response.json()) as { avatarUrl: string };
  await expect(panel.locator('.bot-artwork-trigger img')).toHaveAttribute(
    'src',
    avatarUrl,
  );
  await expect(page.locator('.bot-identity img')).toHaveAttribute(
    'src',
    avatarUrl,
  );
  await expect(
    page
      .locator('.bot-toggle')
      .filter({ hasText: /^Echo$/u })
      .locator('img'),
  ).toHaveAttribute('src', avatarUrl);
  await expect(panel.getByLabel('Name', { exact: true })).toHaveValue(
    'Unsaved name',
  );
  expect(await (await page.request.get('/api/bots/echo')).json()).toEqual(
    original,
  );
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(
      panel.getByRole('button', { name: 'Change image' }),
    ).toBeVisible();
    const artworkBox = await panel
      .locator('.bot-artwork-trigger')
      .boundingBox();
    const nameBox = await panel
      .getByLabel('Name', { exact: true })
      .boundingBox();
    const controlBox = await panel
      .getByRole('button', { name: 'Change image' })
      .boundingBox();
    if (!artworkBox || !nameBox || !controlBox)
      throw new Error('Missing bot identity controls');
    expect(controlBox.x).toBeGreaterThanOrEqual(
      artworkBox.x + artworkBox.width,
    );
    expect(controlBox.y).toBeGreaterThanOrEqual(nameBox.y + nameBox.height);
    expect(controlBox.x + controlBox.width).toBeLessThanOrEqual(width);

    expect(
      await panel.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      animations: 'disabled',
      path: `/tmp/simplebot-image-${String(width)}.png`,
    });
  }
  await panel.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(panel.getByLabel('Name', { exact: true })).toHaveValue('Echo');
  await expect(panel.locator('.bot-artwork-trigger img')).toHaveAttribute(
    'src',
    avatarUrl,
  );
  await expect(
    panel.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled();
  await panel.getByRole('button', { name: 'Close panel', exact: true }).click();
  await page.reload();
  await expect(page.locator('.bot-identity img')).toHaveAttribute(
    'src',
    avatarUrl,
  );
  expect(Buffer.from(await (await page.request.get(avatarUrl)).body())).toEqual(
    png,
  );
  expect(errors).toEqual([]);
});
