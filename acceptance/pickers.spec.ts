import { expect, test } from '@playwright/test';
import { sessionProjectionSchema } from '../shared/src/contracts.js';
import {
  presetDocumentSchema,
  settingsDocumentSchema,
} from '../shared/src/authored.js';

test('searchable pickers preserve draft boundaries and persist conversation selection on desktop and phone', async ({
  page,
  request,
}) => {
  const original = presetDocumentSchema.parse(
    await (await request.get('/api/presets/default')).json(),
  );
  const slug = 'searchable-preset';
  await expect(
    await request.put(`/api/presets/${slug}`, {
      data: {
        value: { ...original.value, name: 'Searchable preset' },
        expectedRevision: 'missing',
      },
    }),
  ).toBeOK();
  const created = await request.post('/api/sessions', {
    data: { botSlug: 'echo' },
  });
  const session = (await created.json()) as { id: string };
  // A synthetic catalog exercises realistic size without credentials or paid calls.
  await page.route('**/api/providers/*/models', (route) =>
    route.fulfill({
      json: {
        models: Array.from({ length: 400 }, (_, i) => ({
          id: `vendor/model-${String(i)}`,
          name: `Model ${String(i)}`,
          reasoning: true,
          reasoningLevels: ['off', 'high'],
          images: false,
          contextWindow: 100000,
        })),
        error: null,
      },
    }),
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Preset settings' }).click();
  const panel = page.getByRole('dialog', {
    name: 'Preset settings',
    exact: true,
  });
  await panel.getByRole('button', { name: 'Preset', exact: true }).click();
  const presets = panel.getByRole('group', {
    name: 'Preset choices',
    exact: true,
  });
  await presets.getByRole('searchbox').fill('searchable');
  await presets.getByRole('button', { name: /Searchable preset/ }).click();
  await expect(
    panel.getByRole('button', { name: 'Preset', exact: true }),
  ).toContainText('Searchable preset');
  expect(
    sessionProjectionSchema.parse(
      await (await request.get(`/api/sessions/${session.id}`)).json(),
    ).presetSlug,
  ).toBe(slug);
  await page.reload();
  await page.getByRole('button', { name: 'Preset settings' }).click();
  await expect(
    panel.getByRole('button', { name: 'Preset', exact: true }),
  ).toContainText('Searchable preset');
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    const presetTrigger = panel.getByRole('button', {
      name: 'Preset',
      exact: true,
    });
    await presetTrigger.click();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    const presetSearch = presets.getByRole('searchbox');
    if (width < 800) await expect(presetSearch).not.toBeFocused();
    else await expect(presetSearch).toBeFocused();
    await presetSearch.fill('searchable');
    await expect(presets.getByRole('button', { pressed: true })).toContainText(
      'Searchable preset',
    );
    await presetSearch.press('Escape');
    await expect(presetTrigger).toBeFocused();
    await expect(panel).toBeVisible();
    const trigger = panel.getByRole('button', {
      name: 'Main model',
      exact: true,
    });
    expect((await trigger.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await trigger.click();
    await trigger.focus();
    await trigger.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeVisible();
    await trigger.click();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    const picker = panel.getByRole('group', {
      name: 'Main model choices',
      exact: true,
    });
    const search = picker.getByRole('searchbox');
    await expect(search).toHaveValue('');
    if (width < 800) await expect(search).not.toBeFocused();
    else await expect(search).toBeFocused();
    await search.fill('model-376');
    await expect(
      picker.getByRole('button', { name: /^Model 376 / }),
    ).toBeVisible();
    expect(
      await picker
        .locator('.ui-picker-option')
        .evaluateAll((options) =>
          options.every((option) => option.scrollWidth <= option.clientWidth),
        ),
    ).toBe(true);
    const box = await picker.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    if (!box) throw new Error('Picker has no bounds');
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `/tmp/simplebot-picker-${String(width)}.png`,
      animations: 'disabled',
    });
    await picker.getByRole('button', { name: 'Clear search' }).click();
    await expect(search).toHaveValue('');
    await search.press('Escape');
    await expect(picker).toHaveCount(0);
    await expect(panel).toBeVisible();
    await panel
      .getByRole('button', { name: 'Main model', exact: true })
      .click();
    await search.fill('model-376');
    await search.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(picker).toHaveCount(0);
    await expect(
      panel.getByRole('button', { name: 'Main model', exact: true }),
    ).toBeFocused();
  }
  // Choosing a model edits the draft, not its file.
  expect(
    presetDocumentSchema.parse(
      await (await request.get(`/api/presets/${slug}`)).json(),
    ).value.mainModel,
  ).toEqual(original.value.mainModel);
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    panel.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled();
  expect(
    presetDocumentSchema.parse(
      await (await request.get(`/api/presets/${slug}`)).json(),
    ).value.mainModel,
  ).toEqual({
    provider: original.value.mainModel.provider,
    model: 'vendor/model-376',
  });
  expect(errors).toEqual([]);
});

for (const width of [1280, 390, 320]) {
  test(`inline timezone selection saves and discards at ${String(width)}px`, async ({
    page,
    request,
  }) => {
    const original = settingsDocumentSchema.parse(
      await (await request.get('/api/settings')).json(),
    );
    const timezone =
      original.value.application.timezone === 'Europe/London'
        ? 'Asia/Tokyo'
        : 'Europe/London';
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (['warning', 'error'].includes(message.type()))
        errors.push(message.text());
    });
    try {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/');
      await expect(page).toHaveTitle(/SimpleBot/u);
      const drawer = page.getByRole('button', {
        name: 'Open conversations',
        exact: true,
      });
      if (width < 800) await drawer.click();
      await page
        .getByRole('button', { name: 'Application settings', exact: true })
        .click();
      const panel = page.getByRole('dialog', {
        name: 'Application settings',
        exact: true,
      });
      const trigger = panel.getByRole('button', {
        name: 'Timezone',
        exact: true,
      });
      const dialogs = await page.getByRole('dialog').count();
      await trigger.click();
      await expect(page.getByRole('dialog')).toHaveCount(dialogs);
      const picker = panel.getByRole('group', { name: 'Timezone choices' });
      const search = picker.getByRole('searchbox');
      if (width < 800) await expect(search).not.toBeFocused();
      else await expect(search).toBeFocused();
      await search.fill(timezone);
      await page.screenshot({
        path: `/tmp/simplebot-polish-timezone-${String(width)}.png`,
      });
      await picker.getByRole('button', { name: new RegExp(timezone) }).click();
      await expect(trigger).toBeFocused();
      expect(
        settingsDocumentSchema.parse(
          await (await request.get('/api/settings')).json(),
        ).value,
      ).toEqual(original.value);
      await panel.getByRole('button', { name: 'Discard', exact: true }).click();
      await expect(
        panel.getByRole('button', { name: 'Save', exact: true }),
      ).toBeDisabled();
      await trigger.click();
      await search.fill(timezone);
      await search.press('Enter');
      await panel.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(
        panel.getByRole('button', { name: 'Save', exact: true }),
      ).toBeDisabled();
      expect(
        settingsDocumentSchema.parse(
          await (await request.get('/api/settings')).json(),
        ).value.application.timezone,
      ).toBe(timezone);
      await page.reload();
      if (width < 800) await drawer.click();
      await page
        .getByRole('button', { name: 'Application settings', exact: true })
        .click();
      await expect(trigger).toContainText(
        timezone.split('/').at(-1) ?? timezone,
      );
      expect(errors).toEqual([]);
    } finally {
      const latest = settingsDocumentSchema.parse(
        await (await request.get('/api/settings')).json(),
      );
      await expect(
        await request.put('/api/settings', {
          data: { value: original.value, expectedRevision: latest.revision },
        }),
      ).toBeOK();
    }
  });
}
