import { expect, test } from '@playwright/test';
import { createSessionResponseSchema } from '../shared/src/contracts.js';

test('pending record saves contain focus, preserve failures, and restore focus after rename', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Open conversations', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'New conversation with Echo', exact: true })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Message', exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: 'Conversation controls', exact: true })
    .click();
  await page.getByRole('button', { name: 'Add variable', exact: true }).click();
  const editor = page.getByRole('dialog', {
    name: 'Add variable',
    exact: true,
  });
  await editor.getByLabel('Variable name').fill('review');
  await editor.getByLabel('Value', { exact: true }).fill('retained draft');
  const release = Promise.withResolvers<undefined>();
  await page.route('**/api/sessions/*/variables', async (route) => {
    await release.promise;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Review write refused' }),
    });
  });
  try {
    await editor.getByRole('button', { name: 'Create variable' }).click();
    await expect(
      editor.getByRole('button', { name: 'Saving…' }),
    ).toBeDisabled();
    const close = editor.getByRole('button', { name: 'Discard' });
    await expect(close).toBeFocused();
    await close.click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    // Native dialogs allow browser chrome, but never background app controls.
    expect(
      await editor.evaluate(
        (node) =>
          document.activeElement === document.body ||
          node.contains(document.activeElement),
      ),
    ).toBe(true);
    await page.keyboard.press('Shift+Tab');
    await expect(close).toBeFocused();
    expect(
      await editor.evaluate((node) => node.contains(document.activeElement)),
    ).toBe(true);
  } finally {
    release.resolve(undefined);
  }
  await expect(editor.getByRole('alert')).toBeVisible();
  await expect(editor.getByLabel('Value', { exact: true })).toHaveValue(
    'retained draft',
  );
  await editor.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Add variable', exact: true }),
  ).toBeFocused();
  await page.unroute('**/api/sessions/*/variables');
  await page.getByRole('button', { name: 'Add variable', exact: true }).click();
  await editor.getByLabel('Variable name').fill('review');
  await editor.getByRole('button', { name: 'Create variable' }).click();
  await page
    .getByRole('button', { name: 'Edit variable review', exact: true })
    .click();
  const rename = page.getByRole('dialog', {
    name: 'Edit variable review',
    exact: true,
  });
  await rename.getByLabel('Variable name').fill('renamed');
  await rename.getByRole('button', { name: 'Save variable' }).click();
  await expect(
    page.getByRole('button', { name: 'Edit variable renamed', exact: true }),
  ).toBeFocused();
});

test('connection entry rows save on Enter and cancel with X', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Capabilities', exact: true }).click();
  await page
    .getByRole('button', { name: 'Add MCP server', exact: true })
    .click();
  const add = page.getByRole('dialog', { name: 'Add MCP server', exact: true });
  await add.getByLabel('Name', { exact: true }).fill('entry-review');
  await add.getByLabel('Command', { exact: true }).fill('example-command');
  await add.getByRole('button', { name: 'Done', exact: true }).click();
  await page
    .getByRole('button', { name: 'Edit entry-review', exact: true })
    .click();
  const editor = page.getByRole('dialog', {
    name: 'Edit entry-review',
    exact: true,
  });
  await editor.getByRole('button', { name: 'Add environment entry' }).click();
  await editor.getByLabel('Environment name 1').fill('REVIEW_KEY');
  await editor
    .getByLabel('Environment value 1', { exact: true })
    .fill('${REVIEW_KEY}');
  await editor
    .getByLabel('Environment value 1', { exact: true })
    .press('Enter');
  await expect(editor).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Edit entry-review', exact: true })
    .click();
  await expect(editor.getByLabel('Environment name 1')).toHaveValue(
    'REVIEW_KEY',
  );
  await expect(
    editor.getByLabel('Environment value 1', { exact: true }),
  ).toHaveValue('${REVIEW_KEY}');
});

test('phone connection editors fit the viewport and confirm deletion', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 320, height: 740 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page).toHaveTitle(/SimpleBot/);
  await page
    .getByRole('button', { name: 'Open conversations', exact: true })
    .click();
  await page.getByRole('button', { name: 'Providers and keys' }).click();
  const providerPanel = page.getByRole('dialog', {
    name: 'Providers & Keys settings',
  });
  const removeProvider = providerPanel
    .getByRole('button', { name: /^Remove provider /u })
    .first();
  await removeProvider.click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  await providerPanel
    .getByRole('button', { name: /^Edit /u })
    .first()
    .click();
  const provider = page.getByRole('dialog', { name: /^Edit /u });
  await provider
    .getByLabel('Base URL', { exact: true })
    .fill(`https://example.test/${'long/'.repeat(40)}`);
  await expect(
    provider.getByRole('button', { name: 'Done', exact: true }),
  ).toBeInViewport();
  for (const input of await provider.locator('input').all()) {
    const box = await input.boundingBox();
    if (!box) throw new Error('Missing input');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    expect(box.width).toBeGreaterThan(180);
  }
  await provider.getByRole('button', { name: 'Discard', exact: true }).click();
  await page.getByRole('button', { name: 'Close panel' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Conversations', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Capabilities', exact: true }).click();
  await page
    .getByRole('button', { name: 'Add MCP server', exact: true })
    .click();
  const editor = page.getByRole('dialog', {
    name: 'Add MCP server',
    exact: true,
  });
  await editor.getByLabel('Name', { exact: true }).fill('phone-review');
  await editor.getByLabel('Command', { exact: true }).fill('example-command');
  await editor.getByRole('button', { name: 'Add environment entry' }).click();
  await editor.getByLabel('Environment name 1').fill('EXAMPLE');
  await editor
    .getByLabel('Environment value 1', { exact: true })
    .fill('${EXAMPLE_' + 'LONG_'.repeat(20) + 'KEY}');
  for (const input of await editor.locator('input').all()) {
    const box = await input.boundingBox();
    if (!box) throw new Error('Missing input');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
  expect(
    await editor
      .locator('.settings-group')
      .evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await expect(
    editor.getByRole('button', { name: 'Done', exact: true }),
  ).toBeInViewport();
  const nameBox = await editor
    .getByLabel('Name', { exact: true })
    .boundingBox();
  const connectionBox = await editor
    .locator('.provider-connection')
    .boundingBox();
  if (!nameBox || !connectionBox) throw new Error('Missing connection fields');
  expect(connectionBox.y).toBeGreaterThanOrEqual(nameBox.y + nameBox.height);
  await editor.getByRole('button', { name: 'Done', exact: true }).click();
  const item = page.getByRole('button', {
    name: 'Edit phone-review',
    exact: true,
  });
  await page
    .getByRole('button', {
      name: 'Remove MCP server phone-review',
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(item).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('toolbar and composer overlay the transcript while reserving readable edges', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const created = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/sessions' &&
      response.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Open conversations', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'New conversation with Echo', exact: true })
    .click();
  const { id } = createSessionResponseSchema.parse(
    await (await created).json(),
  );
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('simplebot-session')))
    .toBe(id);
  await expect(page.locator('.msg-row')).toHaveCount(0);
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(input).toBeEnabled();
  await page.emulateMedia({ colorScheme: 'dark' });
  await input.fill('Viewport review line.\n'.repeat(70));
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.msg-row.is-assistant').last()).toContainText(
    /Acceptance reply/u,
  );
  await expect(input).toBeEnabled();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await input.fill('A growing draft\n'.repeat(8));
    await page.locator('.msg-scroll').evaluate((node) => {
      node.scrollTop = 0;
    });
    const header = await page.locator('.shell-header').boundingBox();
    const first = await page.locator('.msg-column').boundingBox();
    if (!header || !first) throw new Error('Missing transcript or toolbar');
    expect(first.y).toBeGreaterThanOrEqual(header.y + header.height);
    await page.locator('.msg-scroll').evaluate((node) => {
      node.scrollTop = 200;
    });
    await expect
      .poll(async () =>
        page.locator('.conversation').evaluate((node) => {
          const zone = node.querySelector('.composer-zone');
          const scroll = node.querySelector('.msg-scroll');
          const toolbar = document.querySelector('.shell-header');
          if (!zone || !scroll || !toolbar) return false;
          const composerBox = zone.getBoundingClientRect();
          const transcriptBox = scroll.getBoundingClientRect();
          return (
            Math.abs(transcriptBox.top - toolbar.getBoundingClientRect().top) <
              2 &&
            Math.abs(transcriptBox.bottom - composerBox.bottom) < 2 &&
            parseFloat(getComputedStyle(scroll).paddingBottom) >=
              composerBox.height &&
            getComputedStyle(zone).backgroundColor === 'rgba(0, 0, 0, 0)' &&
            getComputedStyle(zone).pointerEvents === 'none'
          );
        }),
      )
      .toBe(true);
    await page.emulateMedia({ colorScheme: 'light' });
    await input.fill('');
    await expect
      .poll(async () => {
        const field = await input.boundingBox();
        const row = await page.locator('.composer-entry').boundingBox();
        return field !== null && row !== null && Math.abs(field.y - row.y) < 1;
      })
      .toBe(true);
    await page.emulateMedia({ colorScheme: 'dark' });
  }
  await page.route('**/api/sessions', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Navigation failure for layout review' }),
    }),
  );
  await page
    .getByRole('button', { name: 'New conversation with Echo', exact: true })
    .click();
  const notice = page.locator('.shell-main > .ui-notice');
  await expect(notice).toBeVisible();
  const noticeBox = await notice.boundingBox();
  const toolbarBox = await page.locator('.shell-header').boundingBox();
  if (!noticeBox || !toolbarBox) throw new Error('Missing navigation warning');
  expect(noticeBox.y).toBeGreaterThanOrEqual(toolbarBox.y + toolbarBox.height);
});

test('message sheets preserve transcript layout, failed drafts, and saved source on desktop and phone', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const created = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/sessions' &&
      response.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'New conversation with Echo', exact: true })
    .click();
  const { id } = createSessionResponseSchema.parse(
    await (await created).json(),
  );
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('simplebot-session')))
    .toBe(id);
  await expect(page.locator('.msg-row')).toHaveCount(0);
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Message editor review.\n'.repeat(35));
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.msg-row.is-assistant')).toContainText(
    'Acceptance reply',
  );
  await expect(composer).toBeEnabled();
  for (const [width, role] of [
    [1280, 'user'],
    [390, 'assistant'],
  ] as const) {
    await page.setViewportSize({ width, height: 844 });
    const row = page.locator(`.msg-row.is-${role}`).last();
    const opener = row.getByRole('button', { name: 'Edit message' });
    await opener.scrollIntoViewIfNeeded();
    const toolbar = await row.locator('.msg-footer').innerHTML();
    const height = await row.evaluate(
      (node) => node.getBoundingClientRect().height,
    );
    await opener.click();
    const editor = page.getByRole('dialog');
    await expect(editor).toBeVisible();
    expect(await row.locator('.msg-footer').innerHTML()).toBe(toolbar);
    expect(
      await row.evaluate((node) => node.getBoundingClientRect().height),
    ).toBe(height);
    await expect(row.locator('textarea')).toHaveCount(0);
    const input = editor.getByRole('textbox');
    await expect(input).toHaveCSS('font-size', '16px');
    await expect(composer).toHaveCSS('font-size', '16px');
    const source = `Edited ${role} source.\n**Markdown stays source.**`;
    await input.fill(source);
    let writes = 0;
    await page.route('**/api/sessions/*/*/*/source', (route) => {
      writes++;
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Write refused' }),
      });
    });
    const save = editor.getByRole('button', { name: 'Save message changes' });
    await expect(save).toBeInViewport();
    const size = await save.evaluate((node) => ({
      width: node.clientWidth,
      height: node.clientHeight,
    }));
    const target = width <= 800 ? 44 : 32;
    expect(size.width).toBeGreaterThanOrEqual(target);
    expect(size.height).toBeGreaterThanOrEqual(target);
    await save.click();
    await expect(editor.getByRole('alert')).toHaveText('Write refused');
    await expect(input).toHaveValue(source);
    expect(writes).toBe(1);
    await expect(page.getByRole('alert')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    await opener.click();
    await expect(input).not.toHaveValue(source);
    await input.fill(source);
    await page.unroute('**/api/sessions/*/*/*/source');
    await save.click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(opener).toBeFocused();
    // A save can shorten the transcript; closing an unchanged editor must not move it.
    await opener.click();
    await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue(
      source,
    );
    const beforeClose = await page
      .locator('.msg-scroll')
      .evaluate((node) => node.scrollTop);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Discard' })
      .click();
    expect(
      await page.locator('.msg-scroll').evaluate((node) => node.scrollTop),
    ).toBe(beforeClose);
    await page.reload();
    await expect(row).toContainText(`Edited ${role} source.`);
  }
  const reply = page.locator('.msg-row.is-assistant').last();
  await reply.getByRole('button', { name: 'Generate another reply' }).click();
  await expect(reply.getByLabel('Variant 2 of 2')).toBeVisible();
  await expect(composer).toBeEnabled();
  await page.setViewportSize({ width: 320, height: 740 });
  const remove = reply.getByRole('button', { name: 'Delete swipe' });
  await expect(remove).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await remove.click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Cancel' })
    .click();
  await expect(reply.getByLabel('Variant 2 of 2')).toBeVisible();
  await remove.click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete swipe' })
    .click();
  await expect(reply.getByLabel('Variant 1 of 1')).toBeVisible();
  await expect(reply).toContainText('Edited assistant source.');
  await page
    .getByRole('button', { name: 'Conversation controls', exact: true })
    .click();
  await expect(
    page.getByText('Last request tokens', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Total tokens', { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('native modal layers return to the drawer and preserve settings across viewport changes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const open = page.getByRole('button', {
    name: 'Open conversations',
    exact: true,
  });
  await open.click();
  const settings = page.getByRole('button', {
    name: 'Application settings',
    exact: true,
  });
  await settings.click();
  const panel = page.getByRole('dialog', {
    name: 'Application settings',
    exact: true,
  });
  // Even a programmatic focus request cannot enter the underlying drawer.
  await page
    .locator('.drawer-search input')
    .evaluate((input: HTMLInputElement) => input.focus());
  expect(
    await panel.evaluate((node) => node.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(settings).toBeFocused();
  await page.mouse.click(385, 840);
  await expect(open).toBeFocused();
  await open.click();
  await settings.click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('.drawer-slot')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.drawer-slot')).toHaveCount(0);
  await expect(panel).toBeVisible();
  await expect(
    panel.getByRole('button', { name: 'Close panel' }),
  ).toBeEnabled();
  await panel.getByRole('button', { name: 'Close panel' }).click();
  await expect(open).toBeVisible();
});
