import { expect, test, type Locator } from '@playwright/test';

async function expectTrace(row: Locator, variant: number, completed: boolean) {
  const entries = row
    .getByRole('list', { name: 'Reasoning and tool calls' })
    .locator(':scope > li');
  await expect(entries).toHaveCount(completed ? 5 : 4);
  await expect(entries.nth(0)).toHaveText(`Trace ${String(variant)} before.`);
  await expect(entries.nth(1)).toContainText('system__calculator');
  await expect(entries.nth(1)).toContainText('Done');
  await expect(entries.nth(2)).toHaveText(`Trace ${String(variant)} between.`);
  await expect(entries.nth(3)).toContainText('system__wall_clock');
  if (completed)
    await expect(entries.nth(4)).toHaveText(`Trace ${String(variant)} after.`);
}

const viewport = { width: 390, height: 844 };
test(`ordered reasoning and tools survive streaming, swipe selection, and reload at ${String(viewport.width)}px`, async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning')
      errors.push(message.text());
  });
  await page.setViewportSize(viewport);
  await page.goto('/');
  await expect(page).toHaveTitle(/SimpleBot/u);
  await expect(page).toHaveURL('/');
  await page.getByRole('button', { name: 'Open conversations' }).click();
  const prior = await page.evaluate(() =>
    localStorage.getItem('simplebot-session'),
  );
  await page
    .getByRole('button', { name: 'New conversation with Echo' })
    .click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('simplebot-session')))
    .not.toBe(prior);
  await expect(page.locator('.msg-row')).toHaveCount(0);
  const message = page.getByRole('textbox', { name: 'Message' });
  await expect(message).toBeEnabled();
  await message.fill(`Acceptance ordered trace ${String(viewport.width)}`);
  await page.getByRole('button', { name: 'Send message' }).click();
  const row = page.locator('.msg-row.is-assistant').last();
  await expect(
    page.getByRole('button', { name: 'Stop response' }),
  ).toBeVisible();
  const thinking = row.getByRole('button', { name: /Thinking/u });
  await expect(thinking).toHaveAttribute('aria-expanded', 'false');
  await thinking.click();
  await expectTrace(row, 1, false);
  await expect(row).toContainText('Ordered answer 1.');
  await expect(message).toBeEnabled();
  await expect(row.getByRole('button', { name: /Thought/u })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expectTrace(row, 1, true);
  await row.getByText('system__calculator', { exact: true }).click();
  await expect(
    row.getByText('"expression": "2+2"', { exact: false }),
  ).toBeVisible();
  await expect(row.getByText('4', { exact: true })).toBeVisible();

  await row.getByRole('button', { name: 'Generate another reply' }).click();
  await expect(thinking).toHaveAttribute('aria-expanded', 'false');
  await thinking.click();
  await expectTrace(row, 2, false);
  await thinking.click();
  await expect(row).toContainText('Ordered answer 2.');
  await expect(row.getByText('2/2', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: /Thought/u })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await row.getByRole('button', { name: /Thought/u }).click();
  await expectTrace(row, 2, true);
  await page.reload();
  await row.getByRole('button', { name: /Thought/u }).click();
  await expectTrace(row, 2, true);
  await row.getByRole('button', { name: 'Previous variant' }).click();
  await expect(row.getByText('1/2', { exact: true })).toBeVisible();
  const disclosure = row.getByRole('button', { name: /Thought/u });
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await disclosure.click();
  await expectTrace(row, 1, true);
  await page.reload();
  await row.getByRole('button', { name: /Thought/u }).click();
  await expectTrace(row, 1, true);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('ordered-trace.png') });
  await page.setViewportSize({ width: 1280, height: 800 });
  await expectTrace(row, 1, true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBe(0);
});
