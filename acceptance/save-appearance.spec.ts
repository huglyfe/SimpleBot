import { expect, test } from '@playwright/test';

// Hold writes at the network boundary rather than the installed worker.
test.use({ serviceWorkers: 'block' });

for (const surface of ['Bot', 'Preset']) {
  test(`${surface} save locks fields without dimming rows, then restores interaction after failure and success`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const botName = `Save appearance ${surface} ${testInfo.project.name}`;
    await page.goto('/');
    await page.getByRole('banner').waitFor();
    const drawer = page.getByRole('button', {
      name: 'Open conversations',
      exact: true,
    });
    if (await drawer.isVisible()) await drawer.click();
    await page.getByRole('button', { name: 'New bot', exact: true }).click();
    const create = page.getByRole('dialog', { name: 'New bot', exact: true });
    await create.getByLabel('Bot name').fill(botName);
    await create
      .getByRole('button', { name: 'Create bot', exact: true })
      .click();
    if (surface === 'Preset') {
      await page
        .getByRole('button', { name: 'Close panel', exact: true })
        .click();
      if (await drawer.isVisible()) await drawer.click();
      await page
        .getByRole('button', {
          name: `New conversation with ${botName}`,
          exact: true,
        })
        .click();
      await page
        .getByRole('button', { name: 'Preset settings', exact: true })
        .click();
    }
    const panel = page.getByRole('dialog', {
      name: `${surface} settings`,
      exact: true,
    });
    const draftName = `Draft ${surface} ${testInfo.project.name}`;
    const name = panel.getByLabel('Name', { exact: true });
    await name.fill(draftName);
    const fields = panel.locator('form > fieldset').first();
    const row = panel.getByRole('button', {
      name: 'Edit Description',
      exact: true,
    });
    const rowElement = await row.elementHandle();
    const appearance = () =>
      rowElement.evaluate((element) => {
        const style = getComputedStyle(element);
        return { opacity: style.opacity, color: style.color };
      });
    const before = await appearance();
    for (const fail of [true, false]) {
      const pending = Promise.withResolvers<undefined>();
      await page.route('**/api/**', async (route) => {
        if (route.request().method() !== 'PUT') return route.continue();
        await pending.promise;
        if (fail)
          return route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Test save failure' }),
          });
        return route.continue();
      });
      await panel.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(fields).toHaveAttribute('inert', '');
      expect(await appearance()).toEqual(before);
      await name.evaluate((element) => element.focus());
      await expect(
        panel.getByRole('button', { name: 'Close panel', exact: true }),
      ).toBeFocused();
      const bounds = await rowElement.boundingBox();
      if (!bounds) throw new Error('Description row has no bounds');
      await page.mouse.click(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      );
      await expect(
        page.getByRole('dialog', { name: 'Edit Description', exact: true }),
      ).toHaveCount(0);
      await panel
        .getByRole('button', { name: 'Close panel', exact: true })
        .click();
      await expect(panel).toBeVisible();
      pending.resolve(undefined);
      await expect(fields).not.toHaveAttribute('inert');
      await page.unroute('**/api/**');
      await expect(name).toHaveValue(draftName);
      if (fail)
        await expect(panel.getByRole('alert')).toContainText(
          'Test save failure',
        );
    }
    expect(errors).toEqual([]);
    await row.click();
    await expect(
      page.getByRole('dialog', { name: 'Edit Description', exact: true }),
    ).toBeVisible();
  });
}
