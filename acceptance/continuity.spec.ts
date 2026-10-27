import { expect, test, type Page } from '@playwright/test';

function sessionId(value: unknown): string {
  if (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string'
  )
    return value.id;
  throw new Error('Create-session response did not contain an id');
}

async function startHelpConversation(page: Page): Promise<void> {
  const created = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/sessions' &&
      response.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'New conversation with Help' })
    .click();
  const id = sessionId(await (await created).json());
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('simplebot-session')))
    .toBe(id);
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeEnabled();
}

test('renames a session and requires confirmation before deleting it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await startHelpConversation(page);
  const active = page.locator('.session-row.is-active');
  const actions = active.getByRole('button', {
    name: 'Actions for New conversation',
  });
  await actions.click();
  await page.getByRole('menuitem', { name: 'Edit title' }).click();
  const title = page.getByRole('textbox', { name: 'Conversation title' });
  const editor = page.getByRole('dialog', { name: 'Edit conversation title' });
  await expect(editor.getByRole('button', { name: 'Discard' })).toBeFocused();
  await title.fill('Discarded title');
  await editor.getByRole('button', { name: 'Discard' }).click();
  await expect(
    active.getByRole('button', { name: 'New conversation', exact: true }),
  ).toBeVisible();
  await actions.click();
  await page.getByRole('menuitem', { name: 'Edit title' }).click();
  await title.fill('   ');
  await title.press('Enter');
  await expect(editor).toBeVisible();
  await expect(
    editor.getByRole('button', { name: 'Save title' }),
  ).toBeDisabled();
  await title.fill('Named acceptance story');
  await title.press('Enter');
  await expect(
    active.getByRole('button', { name: 'Named acceptance story', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    page.getByText('Named acceptance story', { exact: true }),
  ).toBeVisible();

  await page
    .getByRole('button', { name: 'Actions for Named acceptance story' })
    .click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(
    page.getByText('Named acceptance story', { exact: true }),
  ).toBeVisible();

  await page
    .getByRole('button', { name: 'Actions for Named acceptance story' })
    .click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete', exact: true })
    .click();
  await expect(
    page.getByText('Named acceptance story', { exact: true }),
  ).toHaveCount(0);
});
