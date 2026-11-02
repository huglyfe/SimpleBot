import { skillDocumentSchema } from '../shared/src/contracts.js';
import { expect, test as base } from '@playwright/test';
import {
  presetDocumentSchema,
  settingsDocumentSchema,
} from '../shared/src/authored.js';

// Restore root configuration even when a journey fails; no test inherits another's edits.
const test = base.extend<{ restoreSettings: undefined }>({
  restoreSettings: [
    async ({ request }, use) => {
      const original = settingsDocumentSchema.parse(
        await (await request.get('/api/settings')).json(),
      );
      await use(undefined);
      const latest = settingsDocumentSchema.parse(
        await (await request.get('/api/settings')).json(),
      );
      if (latest.revision !== original.revision) {
        expect(
          (
            await request.put('/api/settings', {
              data: {
                value: original.value,
                expectedRevision: latest.revision,
              },
            })
          ).ok(),
        ).toBe(true);
      }
    },
    { auto: true },
  ],
});

const errorsByPage = new WeakMap<import('@playwright/test').Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  errorsByPage.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      ['error', 'warning'].includes(message.type()) &&
      !message.text().includes('status of 409') &&
      !message.text().includes('status of 503')
    )
      errors.push(message.text());
  });
});
test.afterEach(({ page }) => {
  expect(errorsByPage.get(page)).toEqual([]);
});

// The public boundary: explicit saves, focused edits, and independent catalog refresh.
test('presets save explicit drafts, preserve native controls, and support rename, clone, and delete', async ({
  page,
}) => {
  const config = settingsDocumentSchema.parse(
    await (await page.request.get('/api/settings')).json(),
  );
  await page.request.put('/api/settings', {
    data: {
      value: {
        ...config.value,
        tts: {
          baseUrl: 'http://127.0.0.1:9',
          apiKey: '${ACCEPTANCE_TTS_KEY}',
          model: 'test-speech',
        },
      },
      expectedRevision: config.revision,
    },
  });
  const original = presetDocumentSchema.parse(
    await (await page.request.get('/api/presets/default')).json(),
  );
  await page.request.put('/api/presets/browser-settings', {
    data: { value: original.value, expectedRevision: 'missing' },
  });
  await page.request.post('/api/sessions', {
    data: { botSlug: 'echo', presetSlug: 'browser-settings' },
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page).toHaveTitle(/SimpleBot/u);
  await page.getByRole('button', { name: 'Preset settings' }).click();
  const panel = page.getByRole('dialog', { name: 'Preset settings' });
  await expect(
    panel.getByRole('button', { name: 'Preset', exact: true }),
  ).toContainText('browser-settings');
  await expect(panel.getByRole('button', { name: 'Restore' })).toHaveCount(0);
  await expect(
    panel.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled();
  const persona = panel.getByLabel('Name', { exact: true });
  await persona.fill('Saved browser persona');
  await persona.press('Tab');
  expect(
    presetDocumentSchema.parse(
      await (await page.request.get('/api/presets/browser-settings')).json(),
    ).value.persona.name,
  ).toBe(original.value.persona.name);
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  // Wait for browser save completion; a direct GET can see a write before its response.
  await expect(panel.locator('form > fieldset').first()).not.toHaveAttribute(
    'inert',
  );
  await expect
    .poll(
      async () =>
        presetDocumentSchema.parse(
          await (
            await page.request.get('/api/presets/browser-settings')
          ).json(),
        ).value.persona.name,
    )
    .toBe('Saved browser persona');
  await persona.fill('Discard this later edit');
  await panel.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(persona).toHaveValue('Saved browser persona');
  await expect(
    panel.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled();
  await expect(
    panel.getByRole('button', { name: 'Close panel' }),
  ).toBeFocused();
  await panel.getByRole('button', { name: 'Edit System', exact: true }).click();
  let editor = page.getByRole('dialog', { name: 'Edit System', exact: true });
  await editor.getByLabel('System', { exact: true }).fill('Discard me');
  await editor.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect(
    presetDocumentSchema.parse(
      await (await page.request.get('/api/presets/browser-settings')).json(),
    ).value.prompts.system,
  ).toBe(original.value.prompts.system);
  await panel.getByRole('button', { name: 'Edit System', exact: true }).click();
  await editor.getByLabel('System', { exact: true }).fill('Saved prompt');
  await editor.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.locator('form > fieldset').first()).not.toHaveAttribute(
    'inert',
  );
  expect(
    presetDocumentSchema.parse(
      await (await page.request.get('/api/presets/browser-settings')).json(),
    ).value.prompts.system,
  ).toBe('Saved prompt');
  await panel
    .getByLabel('Main reasoning effort', { exact: true })
    .selectOption('high');
  await panel
    .getByLabel('Summary reasoning effort', { exact: true })
    .selectOption('medium');
  for (let index = 0; index < 5; index++)
    await panel.getByLabel('Speech speed').press('ArrowRight');
  await panel.getByLabel('Use main model for summaries').uncheck();
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.locator('form > fieldset').first()).not.toHaveAttribute(
    'inert',
  );
  await expect(
    panel.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled();
  const saved = presetDocumentSchema.parse(
    await (await page.request.get('/api/presets/browser-settings')).json(),
  ).value;
  expect(saved.mainEffort).toBe('high');
  expect(saved.summaryEffort).toBe('medium');
  expect(saved.tts.speed).toBe(1.25);
  expect(saved.useMainModelForSummary).toBe(false);
  await page.reload();
  await page.getByRole('button', { name: 'Preset settings' }).click();
  await expect(
    panel.getByLabel('Main reasoning effort', { exact: true }),
  ).toHaveValue('high');
  await expect(
    panel.getByLabel('Summary reasoning effort', { exact: true }),
  ).toHaveValue('medium');
  await expect(panel.getByLabel('Speech speed')).toHaveValue('1.25');
  await panel.getByRole('button', { name: 'Preset actions' }).click();
  await panel.getByRole('menuitem', { name: 'Rename preset' }).click();
  editor = page.getByRole('dialog', { name: 'Rename preset', exact: true });
  await editor.getByLabel('Preset name').fill('Friendly preset');
  await editor.getByRole('button', { name: 'Done', exact: true }).click();
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.locator('form > fieldset').first()).not.toHaveAttribute(
    'inert',
  );
  await expect(
    panel.getByRole('button', { name: 'Preset', exact: true }),
  ).toContainText('Friendly preset');
  await panel.getByRole('button', { name: 'Preset actions' }).click();
  await panel.getByRole('menuitem', { name: 'Delete preset' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('alertdialog').getByRole('alert')).toContainText(
    'used by a conversation',
  );
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await panel.getByRole('button', { name: 'Preset actions' }).click();
  await panel.getByRole('menuitem', { name: 'Clone preset' }).click();
  await page.getByLabel('Preset name').fill('Disposable clone');
  await page.getByRole('button', { name: 'Clone', exact: true }).click();
  await expect(
    panel.getByRole('button', { name: 'Preset', exact: true }),
  ).toContainText('Disposable clone');
  await panel.getByRole('button', { name: 'Preset', exact: true }).click();
  await page
    .getByRole('group', { name: 'Preset choices', exact: true })
    .getByRole('button', { name: /Friendly preset/ })
    .click();
  await panel.getByRole('button', { name: 'Preset actions' }).click();
  await panel.getByRole('menuitem', { name: 'Delete preset' }).click();
  await page
    .getByRole('button', { name: 'Preset to delete', exact: true })
    .click();
  await page
    .getByRole('group', { name: 'Preset to delete choices', exact: true })
    .getByRole('button', { name: /Disposable clone/ })
    .click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(
    await page.request.get('/api/presets/disposable-clone'),
  ).not.toBeOK();
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    const threshold = panel.getByLabel('Compaction threshold (tokens)');
    await threshold.scrollIntoViewIfNeeded();
    const box = await threshold.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    await panel
      .getByRole('button', { name: 'Preset', exact: true })
      .scrollIntoViewIfNeeded();
    const actions = panel.getByRole('button', { name: 'Preset actions' });
    await actions.click();
    await expect(panel.getByRole('menu')).toBeVisible();
    await actions.press('Escape');
    await expect(panel.getByRole('menu')).toHaveCount(0);
    await expect(panel).toBeVisible();
    await expect(actions).toBeFocused();
  }
});

test('application validates drafts and saves through dirty-panel dismissal', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Application settings' }).click();
  const application = page.getByRole('dialog', {
    name: 'Application settings',
  });
  await application.getByRole('searchbox').fill('tool calls');
  const limit = application.getByLabel('Tool calls per turn');
  let settingsWrites = 0;
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().endsWith('/api/settings'))
      settingsWrites++;
  });
  await limit.fill('');
  await application.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(limit).toBeFocused();
  expect(settingsWrites).toBe(0);
  await limit.fill('17');
  await limit.press('Tab');
  await application.getByRole('button', { name: 'Close panel' }).click();
  const unsaved = page.getByRole('alertdialog', { name: 'Unsaved changes' });
  await expect(unsaved.getByRole('button')).toHaveText([
    'Cancel',
    'Discard',
    'Save',
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await unsaved.getByRole('button', { name: 'Cancel' }).click();
  await expect(limit).toHaveValue('17');
  await application.getByRole('button', { name: 'Close panel' }).click();
  await unsaved.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(application).toHaveCount(0);
  await expect
    .poll(
      async () =>
        settingsDocumentSchema.parse(
          await (await page.request.get('/api/settings')).json(),
        ).value.application.maxToolCallsPerTurn,
    )
    .toBe(17);
  expect(settingsWrites).toBe(1);
});

test('Skills save independently and publish only after explicit capability refresh', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Capabilities', exact: true }).click();
  const capabilities = page.getByRole('dialog', {
    name: 'Capabilities settings',
  });
  await expect(capabilities.locator('.ui-sheet-actions button')).toHaveCount(3);
  expect(
    await capabilities
      .locator('.ui-sheet-actions button')
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute('aria-label')),
      ),
  ).toEqual(['Refresh capabilities', 'Discard', 'Save']);
  await capabilities.getByRole('button', { name: 'Create Skill' }).click();
  let editor = page.getByRole('dialog', { name: 'Create Skill', exact: true });
  await editor.getByLabel('Name', { exact: true }).fill('browser-skill');
  await editor
    .getByLabel('Description')
    .fill('A browser test Skill. '.repeat(35));
  await expect(editor.getByLabel('Description')).toHaveJSProperty(
    'tagName',
    'TEXTAREA',
  );
  const description = await editor.getByLabel('Description').boundingBox();
  expect(description?.height).toBeGreaterThan(60);
  expect(
    await editor
      .getByLabel('Description')
      .evaluate((element) => element.scrollHeight > element.clientHeight),
  ).toBe(true);
  await editor.getByLabel('Description').evaluate((element) => {
    element.scrollTop = 0;
  });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const labels = await editor
      .locator('label')
      .evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().left),
      );
    expect(labels).toHaveLength(3);
    for (const left of labels) expect(left).toBeCloseTo(labels[0] ?? 0, 0);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await editor.getByLabel('Instructions').fill('Keep things simple.');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    capabilities.getByRole('button', { name: 'Edit browser-skill' }),
  ).toBeVisible();
  const catalogHasSkill = async () =>
    JSON.stringify(
      await (await page.request.get('/api/capabilities')).json(),
    ).includes('browser-skill');
  expect(await catalogHasSkill()).toBe(false);
  expect((await page.request.get('/api/skills/browser-skill')).status()).toBe(
    200,
  );
  await capabilities
    .getByRole('button', { name: 'Refresh capabilities' })
    .click();
  await expect.poll(catalogHasSkill).toBe(true);
  await capabilities
    .getByRole('button', { name: 'Edit browser-skill' })
    .click();
  editor = page.getByRole('dialog', { name: 'Edit browser-skill' });
  await editor.getByLabel('Instructions').fill('Edited instructions');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const savedSkill = skillDocumentSchema.parse(
    await (await page.request.get('/api/skills/browser-skill')).json(),
  );
  expect(savedSkill.value.instructions).toBe('Edited instructions');
  await page.setViewportSize({ width: 390, height: 844 });
  await capabilities
    .getByRole('button', { name: 'Delete Skill browser-skill' })
    .click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(
    capabilities.getByRole('button', { name: 'Edit browser-skill' }),
  ).toHaveCount(0);
  expect(await catalogHasSkill()).toBe(true);
  await capabilities
    .getByRole('button', { name: 'Refresh capabilities' })
    .click();
  await expect.poll(catalogHasSkill).toBe(false);
});

test('load failure uses the standard popup and recovers only on explicit Refresh', async ({
  page,
}) => {
  await page.route('**/api/bootstrap', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Server unavailable' }),
    }),
  );
  await page.goto('/');
  const popup = page.getByRole('alertdialog', { name: 'Unable to load' });
  await expect(popup).toHaveClass('ui-dialog');
  await expect(popup).toContainText('Server unavailable');
  await expect(page.getByRole('alertdialog')).toHaveCount(1);
  await page.unroute('**/api/bootstrap');
  await popup.getByRole('button', { name: 'Refresh' }).click();
  await expect(popup).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Application settings' }),
  ).toBeVisible();
});

for (const width of [1280, 390]) {
  test(`clock preference saves and formats deadlines and messages at ${String(width)}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const created = await page.request.post('/api/sessions', {
      data: { botSlug: 'echo' },
    });
    const session = (await created.json()) as { id: string };
    await page.request.post(`/api/sessions/${session.id}/todos`, {
      data: { title: 'Timed goal', due: '2026-10-23T15:45' },
    });
    await page.goto('/');
    await page
      .getByRole('textbox', { name: 'Message', exact: true })
      .fill('Clock format evidence');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.locator('.msg-time').first()).toHaveText(
      /^\d{2}:\d{2}$/u,
    );
    if (width === 390)
      await page.getByRole('button', { name: 'Open conversations' }).click();
    await page.getByRole('button', { name: 'Application settings' }).click();
    const panel = page.getByRole('dialog', { name: 'Application settings' });
    await panel.getByText('12-hour', { exact: true }).click();
    await expect(
      panel.getByRole('radio', { name: '12-hour', exact: true }),
    ).toBeChecked();
    await panel.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      panel.getByRole('button', { name: 'Save', exact: true }),
    ).toBeDisabled();
    await panel.getByRole('button', { name: 'Close panel' }).click();
    await expect(page.locator('.msg-time').first()).toHaveText(
      /\d{2}:\d{2} [AP]M/u,
    );
    await page.reload();
    await expect(page.locator('.msg-time').first()).toHaveText(
      /\d{2}:\d{2} [AP]M/u,
    );
    await page
      .getByRole('button', { name: 'Conversation controls', exact: true })
      .click();
    await expect(page.getByText(/2026-10-23 03:45 PM/u)).toBeVisible();
  });
}
