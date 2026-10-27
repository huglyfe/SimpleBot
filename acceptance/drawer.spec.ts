import { expect, test } from '@playwright/test';

test('desktop drawer resizes, remembers its width, and leaves phone navigation unchanged', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const divider = page.getByRole('separator', { name: 'Resize conversations' });
  const drawer = page.getByRole('navigation', { name: 'Conversations' });
  const width = () =>
    drawer.evaluate((node) => node.getBoundingClientRect().width);
  await expect(divider).toHaveAttribute('aria-valuenow', '292');

  const bounds = await divider.boundingBox();
  if (bounds === null) throw new Error('Missing drawer divider');
  await page.mouse.move(bounds.x + 4, 350);
  await page.mouse.down();
  // Pointer capture keeps a drag alive outside the narrow handle.
  await page.mouse.move(bounds.x + 124, 500, { steps: 8 });
  await page.mouse.up();
  await expect.poll(width).toBe(412);
  await page
    .getByRole('button', { name: 'Close conversations', exact: true })
    .click();
  await expect(divider).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Open conversations', exact: true })
    .click();
  await expect.poll(width).toBe(412);
  await page.reload();
  await expect.poll(width).toBe(412);

  await divider.focus();
  await divider.press('ArrowLeft');
  await expect.poll(width).toBe(396);
  await divider.press('End');
  await expect.poll(width).toBe(480);
  await page.setViewportSize({ width: 820, height: 800 });
  await expect.poll(width).toBe(420);
  await expect(divider).toHaveAttribute('aria-valuemax', '420');
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(width).toBe(480);
  await divider.press('Home');
  await expect.poll(width).toBe(240);
  await divider.press('Enter');
  await expect.poll(width).toBe(292);
  await divider.press('End');
  await divider.dblclick();
  await expect.poll(width).toBe(292);
  await page.reload();
  await expect.poll(width).toBe(292);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(divider).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Open conversations', exact: true })
    .click();
  const overlay = page.getByRole('dialog', { name: 'Conversations' });
  await expect(overlay).toBeVisible();
  expect(
    await overlay.evaluate((node) => node.getBoundingClientRect().width),
  ).toBeCloseTo(335.4, 0);
  await expect(divider).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(width).toBe(292);
});
