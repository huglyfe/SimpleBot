/** Safari ignores the old out-of-range scroll sentinel; Chromium does not. */
import { expect, test, type Page } from '@playwright/test';
import { createSessionResponseSchema } from '../shared/src/contracts.js';

// The PWA journey owns update prompts; this regression isolates Safari scrolling.
test.use({ serviceWorkers: 'block' });

const TURNS = 12;

async function atLiveEdge(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.querySelector('.msg-scroll');
    if (el === null) throw new Error('No transcript scroll region');
    // One device pixel of slack: fractional layout, not a scroll position.
    return el.scrollHeight - el.clientHeight - el.scrollTop < 2;
  });
}

test('opens a conversation at its newest message and follows replies', async ({
  page,
}) => {
  await page.goto('/');
  const created = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/sessions' &&
      response.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'New conversation with Echo' })
    .click();
  const { id } = createSessionResponseSchema.parse(
    await (await created).json(),
  );
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('simplebot-session')))
    .toBe(id);
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeEnabled();

  const message = page.getByRole('textbox', { name: 'Message' });
  for (let turn = 1; turn <= TURNS; turn++) {
    await message.fill(
      `Turn ${String(turn)}. Enough prose in one exchange that ${String(TURNS)} of them overflow the viewport and make the scroll offset mean something.`,
    );
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(
      page.locator('.msg-row.is-assistant').nth(turn - 1),
    ).toBeVisible();
  }

  // The reply that just arrived is on screen, not above the fold.
  await expect.poll(() => atLiveEdge(page)).toBe(true);

  // Entering the conversation again places the viewport at its end.
  await page.reload();
  await expect(page.locator('.msg-row.is-assistant').last()).toBeVisible();
  await expect.poll(() => atLiveEdge(page)).toBe(true);
});
