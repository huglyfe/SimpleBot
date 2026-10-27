import { expect, test } from '@playwright/test';
import { createSessionResponseSchema } from '../shared/src/contracts.js';
import { botDocumentSchema } from '../shared/src/bots.js';
import { presetDocumentSchema } from '../shared/src/authored.js';

test.use({ serviceWorkers: 'block' });

for (const width of [1280, 390]) {
  test(`bot owns the default and model changes reset draft effort at ${String(width)}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (
        message.text() === 'Service Worker registration blocked by Playwright'
      )
        return;
      if (['error', 'warning'].includes(message.type()))
        errors.push(message.text());
    });
    const seed = presetDocumentSchema.parse(
      await (await page.request.get('/api/presets/default')).json(),
    );
    const slug = `model-preset-${String(width)}`;
    expect(
      (
        await page.request.put(`/api/presets/${slug}`, {
          data: {
            value: {
              ...seed.value,
              name: `000 First ${String(width)}`,
              mainEffort: 'high',
              summaryEffort: 'medium',
            },
            expectedRevision: 'missing',
          },
        })
      ).ok(),
    ).toBe(true);
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page).toHaveTitle(/SimpleBot/u);
    const drawer = page.getByRole('button', {
      name: 'Open conversations',
      exact: true,
    });
    if (await drawer.isVisible()) await drawer.click();
    await page
      .getByRole('button', { name: 'Application settings', exact: true })
      .click();
    const application = page.getByRole('dialog', {
      name: 'Application settings',
      exact: true,
    });
    await expect(application.getByLabel('Default preset')).toHaveCount(0);
    await expect(
      application.getByRole('button', { name: 'Timezone', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `/tmp/simplebot-simplified-application-${String(width)}.png`,
    });
    await application
      .getByRole('button', { name: 'Close panel', exact: true })
      .click();
    if (await drawer.isVisible()) await drawer.click();
    await page.getByRole('button', { name: 'New bot', exact: true }).click();
    const creation = page.getByRole('dialog', { name: 'New bot', exact: true });
    const name = `Model preset ${String(width)}`;
    await creation.getByLabel('Bot name').fill(name);
    await creation
      .getByRole('button', { name: 'Create bot', exact: true })
      .click();
    const bot = page.getByRole('dialog', { name: 'Bot settings', exact: true });
    await expect(bot).toBeVisible();
    const card = botDocumentSchema.parse(
      await (await page.request.get(`/api/bots/${slug}`)).json(),
    );
    // Previous tests may have an earlier alphabetical choice; creation still
    // saves exactly the first display-name/slug choice from the live catalog.
    const presets = (await (await page.request.get('/api/presets')).json()) as {
      presets: { slug: string; name: string }[];
    };
    const first = presets.presets[0];
    expect(card.value.data.extensions?.simplebot?.defaultPreset).toBe(
      first?.slug,
    );
    await expect(bot.getByLabel('Default preset')).toContainText(
      first?.name ?? '',
    );
    await bot.getByLabel('Default preset').click();
    await page
      .getByRole('button', { name: new RegExp(`000 First ${String(width)}`) })
      .click();
    const saveBot = bot.getByRole('button', { name: 'Save', exact: true });
    if (await saveBot.isEnabled()) await saveBot.click();
    await expect(
      bot.getByRole('button', { name: 'Save', exact: true }),
    ).toBeDisabled();
    await page.screenshot({
      path: `/tmp/simplebot-simplified-bot-${String(width)}.png`,
    });
    await bot.getByRole('button', { name: 'Close panel', exact: true }).click();
    if (await drawer.isVisible()) await drawer.click();
    const created = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/sessions' &&
        response.request().method() === 'POST',
    );
    await page
      .getByRole('button', {
        name: `New conversation with ${name}`,
        exact: true,
      })
      .click();
    const session = createSessionResponseSchema.parse(
      await (await created).json(),
    );
    expect(session.presetSlug).toBe(slug);
    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem('simplebot-session')),
      )
      .toBe(session.id);
    let releaseModels!: () => void;
    const modelDiscovery = new Promise<void>((resolve) => {
      releaseModels = resolve;
    });
    await page.route('**/api/providers/*/models', async (route) => {
      await modelDiscovery;
      await route.continue();
    });
    await page
      .getByRole('button', { name: 'Preset settings', exact: true })
      .click();
    const panel = page.getByRole('dialog', {
      name: 'Preset settings',
      exact: true,
    });
    await expect(panel.getByLabel('Main reasoning effort')).toHaveValue('high');
    try {
      await expect(
        panel.getByRole('button', { name: 'Main model', exact: true }),
      ).toBeDisabled();
      await expect(
        panel.getByLabel('Use main model for summaries'),
      ).toBeDisabled();
      await expect(panel.getByLabel('Summary reasoning effort')).toHaveValue(
        'medium',
      );
    } finally {
      releaseModels();
    }
    await expect(
      panel.getByLabel('Use main model for summaries'),
    ).toBeEnabled();
    await panel
      .getByRole('button', { name: 'Main model', exact: true })
      .click();
    await panel
      .getByRole('button', { name: /Faux low faux-acceptance/u })
      .click();
    await expect(panel.getByLabel('Main reasoning effort')).toHaveValue('low');
    await expect(panel.getByLabel('Summary reasoning effort')).toHaveValue(
      'low',
    );
    expect(
      presetDocumentSchema.parse(
        await (await page.request.get(`/api/presets/${slug}`)).json(),
      ).value.mainEffort,
    ).toBe('high');
    await page.screenshot({
      path: `/tmp/simplebot-simplified-effort-${String(width)}.png`,
    });
    await panel.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      panel.getByRole('button', { name: 'Save', exact: true }),
    ).toBeDisabled();
    await page.reload();
    await page
      .getByRole('button', { name: 'Preset settings', exact: true })
      .click();
    await expect(page.getByLabel('Main reasoning effort')).toHaveValue('low');
    await expect(page.getByLabel('Summary reasoning effort')).toHaveValue(
      'low',
    );
    expect(errors).toEqual([]);
  });
}
