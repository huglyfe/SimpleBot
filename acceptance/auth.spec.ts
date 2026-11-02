import { expect, test } from '@playwright/test';

const protectedBaseURL = process.env.SIMPLEBOT_AUTH_ACCEPTANCE_URL;
const ownerKey = process.env.SIMPLEBOT_AUTH_ACCEPTANCE_OWNER_KEY;

test('pairs, resumes, and logs out a protected browser', async ({
  page,
  browser,
}) => {
  if (protectedBaseURL === undefined || ownerKey === undefined)
    throw new Error('Protected acceptance environment is not configured');
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(protectedBaseURL);

  await expect(
    page.getByRole('heading', { name: 'Pair this browser' }),
  ).toBeVisible();
  const pair = page.getByRole('button', { name: 'Pair' });
  expect((await pair.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  const credential = page.getByLabel('Pairing code or owner key');
  await credential.fill('WRONGCREDENTIAL');
  await pair.click();
  await expect(page.getByRole('alert')).toHaveText('Invalid credential');

  await credential.fill(ownerKey);
  await pair.click();
  await expect(
    page.getByRole('heading', { name: 'Start a conversation' }),
  ).toBeVisible();
  const loginCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === 'simplebot_session',
  );
  expect(loginCookie).toBeDefined();
  if (loginCookie === undefined) throw new Error('Login cookie missing');
  const shortenedExpiry = Math.floor(Date.now() / 1000) + 60;
  await page
    .context()
    .addCookies([{ ...loginCookie, expires: shortenedExpiry }]);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Start a conversation' }),
  ).toBeVisible();

  const renewedCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === loginCookie.name,
  );
  expect(renewedCookie?.value).toBe(loginCookie.value);
  expect(renewedCookie?.expires).toBeGreaterThan(shortenedExpiry);

  await page.getByRole('button', { name: 'Open conversations' }).click();
  await page.getByRole('button', { name: 'Application settings' }).click();
  await page.getByRole('searchbox', { name: 'Find a setting' }).fill('session');
  const expiry = page.getByLabel('Browser login expiry (days)');
  await expect(expiry).toHaveValue('30');
  await expiry.fill('0');
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/settings') &&
      response.request().method() === 'PUT',
  );
  await page
    .getByRole('dialog', { name: 'Application settings' })
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  expect((await saved).ok()).toBe(true);
  await page.request.get(`${protectedBaseURL}/api/settings`);
  expect(
    (await page.context().cookies()).find(
      (cookie) => cookie.name === loginCookie.name,
    )?.expires,
  ).toBe(-1);
  const other = await browser.newContext();
  try {
    const paired = await other.request.post(
      `${protectedBaseURL}/api/auth/exchange`,
      { data: { credential: ownerKey } },
    );
    expect(paired.status()).toBe(200);
    expect(
      ((await paired.json()) as { expiresAt: string | null }).expiresAt,
    ).toBeNull();
    expect(
      (await other.request.get(`${protectedBaseURL}/api/settings`)).status(),
    ).toBe(200);
    await expect(
      page.getByRole('dialog').getByRole('heading').last(),
    ).toHaveText('About');
    const loginSection = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Login management', exact: true }),
    });
    await expect(
      loginSection.getByRole('button', { name: 'Log out', exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator('.ui-sheet-header')
        .getByRole('button', { name: 'Log out', exact: true }),
    ).toHaveCount(0);
    await loginSection
      .getByRole('button', { name: 'Purge other logins' })
      .click();
    await page.getByRole('button', { name: 'Purge', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(loginSection.getByRole('status')).toHaveCount(0);
    expect(
      (await other.request.get(`${protectedBaseURL}/api/settings`)).status(),
    ).toBe(401);
    expect(
      (await page.request.get(`${protectedBaseURL}/api/settings`)).status(),
    ).toBe(200);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const logout = page.getByRole('button', { name: 'Log out', exact: true });
      const purge = page.getByRole('button', {
        name: 'Purge other logins',
        exact: true,
      });
      await purge.scrollIntoViewIfNeeded();
      const logoutBounds = await logout.boundingBox();
      const purgeBounds = await purge.boundingBox();
      expect(logoutBounds).not.toBeNull();
      expect(purgeBounds?.y).toBe(logoutBounds?.y);
      expect(purgeBounds?.width).toBe(logoutBounds?.width);
      expect(purgeBounds?.height).toBeGreaterThanOrEqual(44);
      expect(
        await purge.evaluate(
          (button) => button.scrollWidth <= button.clientWidth,
        ),
      ).toBe(true);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page
      .getByRole('button', { name: 'Purge other logins', exact: true })
      .scrollIntoViewIfNeeded();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.getByRole('button', { name: 'Open conversations' }).click();
    await page.getByRole('button', { name: 'Application settings' }).click();
    await expect(page.getByLabel('Browser login expiry (days)')).toHaveValue(
      '0',
    );
  } finally {
    await other.close();
  }
  expect(pageErrors).toEqual([]);
  await page.getByRole('button', { name: /Log out/iu }).click();
  await expect(
    page.getByRole('heading', { name: 'Pair this browser' }),
  ).toBeVisible();
});
