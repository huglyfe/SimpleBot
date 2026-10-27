import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('desktop focus preserves the composer and reading position; footer labels fit their targets', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'New conversation with Echo', exact: true })
    .click();
  const message = page.getByRole('textbox', { name: 'Message', exact: true });
  await message.fill('A long conversation for layout review.\n'.repeat(80));
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.msg-row.is-assistant').last()).toContainText(
    /Acceptance reply/u,
  );
  await expect(message).toBeEnabled();
  await test.step('focus the composer without moving the transcript', async () => {
    const scroll = page.locator('.msg-scroll');
    await message.blur();
    await scroll.evaluate((element) => {
      element.scrollTop = 200;
    });
    await expect
      .poll(() => scroll.evaluate((element) => element.scrollTop))
      .toBe(200);
    const composer = await page.locator('.composer').boundingBox();
    await message.click();
    await expect(message).toBeFocused();
    expect(await page.locator('.composer').boundingBox()).toEqual(composer);
    expect(await scroll.evaluate((element) => element.scrollTop)).toBe(200);
  });

  await test.step('inspect every footer target at minimum drawer width', async () => {
    // The narrowest drawer must still contain the labels and hover backgrounds.
    await page
      .getByRole('separator', { name: 'Resize conversations' })
      .press('Home');
    const footer = page.locator('.sidebar-footer');
    const bounds = await footer.boundingBox();
    if (!bounds) throw new Error('Missing footer');
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(800);
    for (const button of await footer.getByRole('button').all()) {
      const target = await button.boundingBox();
      const icon = await button.locator('svg').boundingBox();
      const label = await button.locator('span').boundingBox();
      if (!target || !icon || !label) throw new Error('Missing footer content');
      expect(target.height).toBeGreaterThanOrEqual(44);
      expect(target.y - bounds.y).toBeGreaterThanOrEqual(8);
      expect(
        bounds.y + bounds.height - target.y - target.height,
      ).toBeGreaterThanOrEqual(8);
      expect(label.x).toBeGreaterThanOrEqual(target.x);
      expect(label.x + label.width).toBeLessThanOrEqual(
        target.x + target.width,
      );
      expect(label.y + label.height).toBeLessThanOrEqual(
        target.y + target.height - 7,
      );
      expect(icon.x + icon.width / 2).toBeCloseTo(
        target.x + target.width / 2,
        0,
      );
      expect(label.x + label.width / 2).toBeCloseTo(
        target.x + target.width / 2,
        0,
      );
    }
  });
});

test('native selections and searchable fields share geometry and type in both themes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page
    .getByRole('button', { name: 'New conversation with Echo', exact: true })
    .click();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page
        .getByRole('banner')
        .getByRole('button', { name: /^(?:E )?Echo$/u })
        .click();
      const bot = page.getByRole('dialog', {
        name: 'Bot settings',
        exact: true,
      });
      await expect(bot.getByLabel('Memory server')).toBeVisible();
      const styles = await bot
        .locator('#config-preset, #bot-memory')
        .evaluateAll((controls) =>
          controls.map((control) => {
            const style = getComputedStyle(control);
            return [
              style.fontSize,
              style.fontWeight,
              style.minHeight,
              style.padding,
              style.borderRadius,
              style.backgroundImage,
            ];
          }),
        );
      expect(styles).toHaveLength(2);
      expect(styles[0]).toEqual(styles[1]);
      expect(styles[0]?.[0]).toBe('16px');
      await page.screenshot({
        path: `/tmp/simplebot-polish-bot-${colorScheme}-${String(width)}.png`,
      });
      await bot
        .getByRole('button', { name: 'Close panel', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Preset settings', exact: true })
        .click();
      const preset = page.getByRole('dialog', {
        name: 'Preset settings',
        exact: true,
      });
      await expect(
        preset.getByRole('heading', { name: 'Main Model', level: 3 }),
      ).toBeVisible();
      await expect(
        preset.getByRole('heading', { name: 'Summary Model', level: 3 }),
      ).toBeVisible();
      await expect(
        preset.getByRole('heading', { name: 'Models', exact: true }),
      ).toHaveCount(0);
      await preset.getByLabel('Use main model for summaries').uncheck();
      await expect(
        preset.getByRole('button', { name: 'Summary model', exact: true }),
      ).toBeVisible();
      await preset.getByLabel('Summary reasoning effort').selectOption('high');
      await expect(preset.getByLabel('Summary reasoning effort')).toHaveValue(
        'high',
      );
      await page.screenshot({
        path: `/tmp/simplebot-polish-models-${colorScheme}-${String(width)}.png`,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await preset
        .getByRole('button', { name: 'Discard', exact: true })
        .click();
      await preset
        .getByRole('button', { name: 'Close panel', exact: true })
        .click();
    }
  }
  expect(errors).toEqual([]);
});

test('long model names, empty catalogs, and absent saved selections remain readable without changing the preset', async ({
  page,
}) => {
  const longName =
    'A long model display name with detailed capability information '.repeat(8);
  let mode: 'long' | 'empty' | 'unavailable' = 'long';
  await page.route('**/api/providers/*/models', (route) =>
    route.fulfill({
      json: {
        models:
          mode === 'empty'
            ? []
            : [
                {
                  id: mode === 'long' ? 'faux-default' : 'replacement-model',
                  name: longName,
                  reasoning: true,
                  reasoningLevels: ['off', 'high'],
                  images: false,
                  contextWindow: 100000,
                },
              ],
        error: null,
      },
    }),
  );
  await page.goto('/');
  await page
    .getByRole('button', { name: 'New conversation with Echo', exact: true })
    .click();
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (mode of ['long', 'empty', 'unavailable'] as const) {
      await page.reload();
      await page
        .getByRole('button', { name: 'Preset settings', exact: true })
        .click();
      const panel = page.getByRole('dialog', {
        name: 'Preset settings',
        exact: true,
      });
      const trigger = panel.getByRole('button', {
        name: 'Main model',
        exact: true,
      });
      await expect(trigger).toBeEnabled();
      await expect(trigger).toContainText(
        mode === 'long' ? longName.trim() : 'faux-default',
      );
      await trigger.click();
      const choices = panel.getByRole('group', {
        name: 'Main model choices',
        exact: true,
      });
      await expect(
        choices.getByRole('button', { pressed: true }),
      ).toBeVisible();
      if (mode !== 'long')
        await expect(
          choices.getByText('Saved selection · not in catalog'),
        ).toBeVisible();
      if (mode === 'empty')
        await expect(
          choices.getByText('No models found.', { exact: false }),
        ).toBeVisible();
      expect(
        await choices.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      expect(
        await panel.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `/tmp/simplebot-catalog-${mode}-${String(width)}.png`,
      });
      await choices.getByRole('searchbox').press('Escape');
      await expect(trigger).toBeFocused();
      await expect(
        panel.getByRole('button', { name: 'Save', exact: true }),
      ).toBeDisabled();
    }
  }
});
