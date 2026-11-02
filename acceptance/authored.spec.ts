import { expect, test as base } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { presetDocumentSchema } from '../shared/src/authored.js';
import { createSessionResponseSchema } from '../shared/src/contracts.js';

// Each journey owns a fresh preset/session, so independent editors cannot affect other tests.
const test = base.extend<{ presetPath: string }>({
  presetPath: async ({ page }, use) => {
    const original = presetDocumentSchema.parse(
      await (await page.request.get('/api/presets/default')).json(),
    );
    const slug = `browser-${randomUUID()}`;
    const path = `/api/presets/${slug}`;
    expect(
      (
        await page.request.put(path, {
          data: { value: original.value, expectedRevision: 'missing' },
        })
      ).ok(),
    ).toBe(true);
    const response = await page.request.post('/api/sessions', {
      data: { botSlug: 'echo', presetSlug: slug },
    });
    expect(response.status()).toBe(201);
    const { id } = createSessionResponseSchema.parse(await response.json());
    await page.addInitScript(
      (sessionId) => localStorage.setItem('simplebot-session', sessionId),
      id,
    );
    await use(path);
  },
});
test.use({ serviceWorkers: 'block' });

test('two editors refuse a stale save without losing the draft, then reload and save the new revision', async ({
  page,
  context,
  presetPath,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Preset settings' }).click();
  const panel = page.getByRole('dialog', { name: 'Preset settings' });
  const name = panel.getByLabel('Name', { exact: true });
  await name.fill('Local unsaved persona');
  const other = await context.newPage();
  other.on('pageerror', (error) => errors.push(error.message));
  try {
    await other.goto('/');
    await other.getByRole('button', { name: 'Preset settings' }).click();
    const otherPanel = other.getByRole('dialog', { name: 'Preset settings' });
    await otherPanel
      .getByLabel('Name', { exact: true })
      .fill('External saved persona');
    await otherPanel.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      otherPanel.locator('form > fieldset').first(),
    ).not.toHaveAttribute('inert');
    const refused = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === presetPath &&
        response.request().method() === 'PUT',
    );
    await panel.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await refused).status()).toBe(409);
    await expect(name).toHaveValue('Local unsaved persona');
    await expect(panel.getByRole('alert')).toBeVisible();
    expect(
      presetDocumentSchema.parse(
        await (await page.request.get(presetPath)).json(),
      ).value.persona.name,
    ).toBe('External saved persona');
    await panel.getByRole('alert').scrollIntoViewIfNeeded();
    await panel.getByRole('button', { name: 'Reload latest' }).click();
    await expect(name).toHaveValue('External saved persona');
    await name.fill('Saved after reload');
    const saved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === presetPath &&
        response.request().method() === 'PUT',
    );
    await panel.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await expect(panel.locator('form > fieldset').first()).not.toHaveAttribute(
      'inert',
    );
    expect(
      presetDocumentSchema.parse(
        await (await page.request.get(presetPath)).json(),
      ).value.persona.name,
    ).toBe('Saved after reload');
    expect(errors).toEqual([]);
  } finally {
    await other.close();
  }
});

test('a confirmed save unlocks editing while its list refresh is still pending', async ({
  page,
  presetPath,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Preset settings' }).click();
  const panel = page.getByRole('dialog', { name: 'Preset settings' });
  const name = panel.getByLabel('Name', { exact: true });
  await name.fill('First saved persona');
  const held = Promise.withResolvers<undefined>();
  const requested = Promise.withResolvers<undefined>();
  await page.route('**/api/presets', async (route) => {
    requested.resolve(undefined);
    await held.promise;
    await route.continue();
  });
  try {
    await panel.getByRole('button', { name: 'Save', exact: true }).click();
    await requested.promise;
    await expect(panel.locator('form > fieldset').first()).not.toHaveAttribute(
      'inert',
    );
    await expect(
      panel.getByRole('button', { name: 'Save', exact: true }),
    ).toBeDisabled();
    await name.fill('Second saved persona');
    const saved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === presetPath &&
        response.request().method() === 'PUT',
    );
    await panel.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await expect(panel.locator('form > fieldset').first()).not.toHaveAttribute(
      'inert',
    );
    expect(
      presetDocumentSchema.parse(
        await (await page.request.get(presetPath)).json(),
      ).value.persona.name,
    ).toBe('Second saved persona');
  } finally {
    held.resolve(undefined);
    await page.unrouteAll({ behavior: 'wait' });
  }
});
