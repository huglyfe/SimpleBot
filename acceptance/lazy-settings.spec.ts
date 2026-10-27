import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

for (const width of [1280, 390]) {
  test(`settings code loads only when opened at ${String(width)}px and returns focus`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const pending = Promise.withResolvers<undefined>();
    let requests = 0;
    await page.route('**/assets/SettingsPanel-*.js', async (route) => {
      requests++;
      await pending.promise;
      await route.continue();
    });
    await page.request.post('/api/sessions', {
      data: { botSlug: 'echo', presetSlug: 'default' },
    });
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'Preset settings' });
    await expect(trigger).toBeVisible();
    expect(requests).toBe(0);
    await trigger.click();
    await expect(page.getByRole('status')).toContainText('Loading settings');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('status')).toHaveCount(0);
    await trigger.click();
    pending.resolve(undefined);
    const panel = page.getByRole('dialog', { name: 'Preset settings' });
    await expect(panel).toBeVisible();
    await expect(
      panel.getByRole('button', { name: 'Close panel' }),
    ).toBeFocused();
    expect(requests).toBe(1);
    await page.screenshot({ path: testInfo.outputPath('lazy-settings.png') });
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(
      page.getByRole('textbox', { name: 'Message', exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('a failed optional settings chunk leaves the conversation usable', async ({
  page,
}) => {
  await page.route('**/assets/SettingsPanel-*.js', (route) => route.abort());
  await page.request.post('/api/sessions', {
    data: { botSlug: 'echo', presetSlug: 'default' },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Preset settings' }).click();
  const panel = page.getByRole('dialog', { name: 'Settings unavailable' });
  await expect(panel.getByRole('alert')).toContainText('Reload the app');
  await panel.getByRole('button', { name: 'Close panel' }).click();
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Conversation still works');
  await expect(
    page.getByRole('button', { name: 'Send message' }),
  ).toBeEnabled();
});
