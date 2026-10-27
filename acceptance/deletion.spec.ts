import { expect, test } from '@playwright/test';
import { createSessionResponseSchema } from '../shared/src/contracts.js';

test('a nested deletion retains pending and failed confirmation until explicit completion', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({
    width: 390,
    height: 844,
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const created = await page.request.post('/api/sessions', {
    data: { botSlug: 'echo' },
  });
  expect(created.status()).toBe(201);
  const { id } = createSessionResponseSchema.parse(await created.json());
  const collection = `/api/sessions/${id}/variables`;
  const saved = await page.request.put(collection, {
    data: { name: 'review', value: 'Retain on failure' },
  });
  expect(saved.status()).toBe(204);
  const endpoint = `${collection}/review`;
  await page.addInitScript(
    (sessionId) => localStorage.setItem('simplebot-session', sessionId),
    id,
  );
  await page.goto('/');
  await expect(page).toHaveTitle(/SimpleBot/u);
  await expect(page).toHaveURL('/');
  await expect(
    page.getByRole('textbox', { name: 'Message', exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: 'Conversation controls', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Delete variable review', exact: true })
    .click();
  const dialog = page.getByRole('alertdialog');
  const release = Promise.withResolvers<undefined>();
  let requests = 0;
  await page.route(`**${endpoint}`, async (route) => {
    requests++;
    await release.promise;
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Deletion refused for review' }),
    });
  });
  try {
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: 'Deleting…' }),
    ).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    await expect(dialog).toBeVisible();
    expect(requests).toBe(1);
  } finally {
    release.resolve(undefined);
  }
  await expect(dialog.getByRole('alert')).toHaveText(
    'Deletion refused for review',
  );
  await expect(
    dialog.getByRole('button', { name: 'Delete', exact: true }),
  ).toBeEnabled();
  expect(requests).toBe(1);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('delete-failure.png') });
  await page.unroute(`**${endpoint}`);
  const deleted = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === endpoint &&
      response.request().method() === 'DELETE',
  );
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  expect((await deleted).status()).toBe(204);
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('button', {
      name: 'Delete variable review',
      exact: true,
    }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
