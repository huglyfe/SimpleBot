import { expect, test } from '@playwright/test';
import { sessionContextSchema } from '../shared/src/contracts.js';

for (const width of [1280, 390]) {
  test(`to-dos use conversation record controls and persist at ${String(width)}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 844 });
    const created = await page.request.post('/api/sessions', {
      data: { botSlug: 'echo' },
    });
    expect(created.ok()).toBe(true);
    const { id } = (await created.json()) as { id: string };
    await page.goto('/');
    await expect(
      page.getByRole('textbox', { name: 'Message', exact: true }),
    ).toBeEnabled();
    await page
      .getByRole('button', { name: 'Conversation controls', exact: true })
      .click();
    for (const name of ['Context status', 'To-dos', 'Variables', 'Schedules'])
      await expect(
        page.getByRole('heading', { name, exact: true }),
      ).toBeVisible();
    await page.getByRole('button', { name: 'Add to-do', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Add to-do', exact: true });
    await expect(editor.getByRole('button', { name: 'Discard' })).toBeFocused();
    await editor
      .getByLabel('Title', { exact: true })
      .fill('Submit application');
    await editor.getByLabel('Due date').fill('2026-10-23');
    await expect(editor.getByLabel('Due time')).toHaveValue('00:00');
    await editor.getByLabel('Due time').fill('15:45');
    await editor
      .getByLabel('Note', { exact: true })
      .fill('Reward: dinner. Price: chores.');
    await page.route('**/api/sessions/*/todos', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Write refused' }),
      }),
    );
    await editor.getByRole('button', { name: 'Create to-do' }).click();
    await expect(editor.getByRole('alert')).toContainText('Write refused');
    await expect(editor.getByLabel('Title', { exact: true })).toHaveValue(
      'Submit application',
    );
    await page.unroute('**/api/sessions/*/todos');
    await editor.getByRole('button', { name: 'Create to-do' }).click();
    await expect(editor).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Add to-do', exact: true }),
    ).toBeFocused();
    const read = async () =>
      sessionContextSchema.parse(
        await (await page.request.get(`/api/sessions/${id}/context`)).json(),
      ).todos;
    const first = (await read())[0];
    expect(first).toMatchObject({
      title: 'Submit application',
      due: '2026-10-23T15:45',
      note: 'Reward: dinner. Price: chores.',
    });
    await page.reload();
    await page
      .getByRole('button', { name: 'Conversation controls', exact: true })
      .click();
    await page
      .getByRole('button', {
        name: 'Edit to-do Submit application',
        exact: true,
      })
      .click();
    const edit = page.getByRole('dialog', {
      name: 'Edit to-do Submit application',
      exact: true,
    });
    await expect(edit.getByLabel('Due time')).toHaveValue('15:45');
    await edit.getByLabel('Due date').fill('');
    await expect(edit.getByLabel('Due time')).toHaveCount(0);
    await edit.getByLabel('Title', { exact: true }).fill('Send application');
    await edit.getByRole('button', { name: 'Save to-do' }).click();
    await expect(
      page.getByRole('button', {
        name: 'Edit to-do Send application',
        exact: true,
      }),
    ).toBeFocused();
    expect(await read()).toEqual([
      { ...first, title: 'Send application', due: null },
    ]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole('button', {
        name: 'Delete to-do Send application',
        exact: true,
      })
      .click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('No closed history');
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(
      page.getByRole('button', {
        name: 'Edit to-do Send application',
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Add to-do', exact: true }),
    ).toBeFocused();
    expect(await read()).toEqual([]);
    expect(errors).toEqual([]);
  });
}
