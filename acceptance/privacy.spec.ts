import { expect, test, type Page } from '@playwright/test';

async function settings(page: Page) {
  await expect(page.locator('.shell-root')).toBeVisible();
  const open = page.getByRole('button', { name: 'Open conversations' });
  if (await open.isVisible()) await open.click();
  await page.getByRole('button', { name: 'Application settings' }).click();
}

async function setPin(page: Page) {
  await settings(page);
  const login = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Login management', exact: true }),
  });
  await login
    .getByRole('button', { name: 'Set privacy PIN', exact: true })
    .click();
  await page.getByLabel('New PIN', { exact: true }).fill('123456');
  await page.getByLabel('Repeat new PIN').fill('123456');
  await page.getByRole('button', { name: 'Save privacy PIN' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
}

async function unlock(page: Page, pin = '123456', succeeds = true) {
  await page.getByLabel('Privacy PIN', { exact: true }).fill(pin);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  if (succeeds)
    await expect(
      page.getByRole('dialog', { name: 'SimpleBot is locked' }),
    ).not.toBeVisible();
}

test('privacy lock preserves drafts, covers panels, checks PIN changes and survives reload with a valid cookie', async ({
  page,
}) => {
  const url = process.env.SIMPLEBOT_AUTH_ACCEPTANCE_URL;
  const key = process.env.SIMPLEBOT_AUTH_ACCEPTANCE_OWNER_KEY;
  if (!url || !key) throw new Error('Protected fixture missing');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await page.getByLabel('Pairing code or owner key').fill(key);
  await page.getByRole('button', { name: 'Pair', exact: true }).click();
  await page.getByRole('button', { name: 'Open conversations' }).click();
  await page
    .getByRole('button', { name: 'New conversation with Echo' })
    .click();
  const message = page.getByRole('textbox', { name: 'Message', exact: true });
  await message.fill('Private unsent draft');
  await setPin(page);
  await page.screenshot({ path: '/tmp/simplebot-login-management-phone.png' });
  await page.getByRole('button', { name: 'Lock now' }).click();
  await page.screenshot({ path: '/tmp/simplebot-lock-phone.png' });
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await expect(
    page.getByRole('dialog', { name: 'SimpleBot is locked' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('dialog', { name: 'SimpleBot is locked' }),
  ).toBeVisible();
  await expect(page.getByLabel('Privacy PIN', { exact: true })).toBeFocused();
  await unlock(page, '000000', false);
  await expect(page.getByRole('alert')).toHaveText('Incorrect PIN.');
  await page.screenshot({ path: '/tmp/simplebot-privacy-phone.png' });
  expect((await page.request.get(`${url}/api/bootstrap`)).status()).toBe(200);
  await unlock(page);
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.getByRole('button', { name: 'Close conversations' }).click();
  await expect(message).toHaveValue('Private unsent draft');

  // Dispatch lifecycle events with a controlled wall clock, without sleeping.
  await message.focus();
  await page.clock.install();
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(
    page.getByRole('dialog', { name: 'SimpleBot is locked' }),
  ).toBeVisible();
  await page.clock.fastForward(1_000);
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect(message).toBeFocused();
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.clock.fastForward(31_000);
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect(
    page.getByRole('dialog', { name: 'SimpleBot is locked' }),
  ).toBeVisible();
  await unlock(page);
  await expect(message).toHaveValue('Private unsent draft');

  await message.fill('Acceptance background response');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.msg-row.is-user').last()).toContainText(
    'Acceptance background response',
  );
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.clock.fastForward(31_000);
  await expect(page.locator('.msg-row.is-assistant').last()).toContainText(
    'Finished in the background.',
    { timeout: 10_000 },
  );
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect(
    page.getByRole('dialog', { name: 'SimpleBot is locked' }),
  ).toBeVisible();
  await unlock(page);
  await expect(page.locator('.msg-row.is-assistant').last()).toBeVisible();

  await settings(page);
  await page.getByRole('button', { name: 'Change privacy PIN' }).click();
  await page.getByLabel('Current PIN').fill('000000');
  await page.getByLabel('New PIN', { exact: true }).fill('654321');
  await page.getByLabel('Repeat new PIN').fill('654321');
  await page.getByRole('button', { name: 'Save privacy PIN' }).click();
  await expect(page.getByRole('alertdialog').getByRole('alert')).toHaveText(
    'Incorrect current PIN.',
  );
  await page.getByLabel('Current PIN').fill('123456');
  await page.getByRole('button', { name: 'Save privacy PIN' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.msg-row')).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: '/tmp/simplebot-privacy-desktop.png' });
  await unlock(page, '654321');
  await expect(message).toBeVisible();
  await settings(page);
  await page
    .getByRole('button', { name: 'Remove privacy PIN', exact: true })
    .click();
  await page.getByLabel('Current PIN').fill('654321');
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Remove privacy PIN' })
    .click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.reload();
  await expect(message).toBeVisible();
  expect(errors).toEqual([]);
});

test('installed shell opens locked offline and caches no private responses', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await setPin(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() =>
      page.evaluate(() => navigator.serviceWorker.controller !== null),
    )
    .toBe(true);
  await page.evaluate(async () => {
    await fetch('/api/bootstrap');
    await fetch('/api/settings');
  });
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const key of await caches.keys())
      for (const request of await (await caches.open(key)).keys())
        urls.push(new URL(request.url).pathname);
    return urls;
  });
  expect(cached).toContain('/index.html');
  expect(cached).toContain('/icon-512.png');
  expect(cached.some((path) => path.startsWith('/api/'))).toBe(false);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'SimpleBot is locked' }),
  ).toBeVisible();
  await expect(page.locator('.msg-row')).toHaveCount(0);
  await unlock(page);
  await expect(page.getByText(/Could not reach SimpleBot/u)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Retry' }).click();
  await unlock(page);
  await expect(
    page.getByRole('button', { name: 'Application settings' }),
  ).toBeVisible();
});

test('malformed PIN storage stays locked', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('simplebot:privacy-pin', 'broken'),
  );
  await page.goto('/');
  await unlock(page, '123456', false);
  await expect(page.getByRole('alert')).toHaveText('Incorrect PIN.');
  await expect(page.locator('.msg-row')).toHaveCount(0);
});

test('background read failures wait behind the privacy lock', async ({
  page,
}) => {
  await page.goto('/');
  await setPin(page);
  await page.clock.install();
  await page.getByRole('button', { name: 'Lock now' }).click();
  await page.route('**/api/bootstrap', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Refresh failed while locked' }),
    });
  });
  await page.clock.fastForward(10_000);
  const failed = page.waitForResponse('**/api/bootstrap');
  await page.evaluate(() =>
    window.dispatchEvent(new Event('visibilitychange')),
  );
  await failed;
  await expect(page.locator('.ui-dialog')).toHaveCount(1);
  await expect(page.locator('.ui-dialog')).not.toBeVisible();
  await expect(page.getByLabel('Privacy PIN', { exact: true })).toBeFocused();
  await unlock(page);
  await expect(page.getByRole('alertdialog')).toContainText(
    'Refresh failed while locked',
  );
  await page.unroute('**/api/bootstrap');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});
