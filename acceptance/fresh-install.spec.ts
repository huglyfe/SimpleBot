import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AuthoredFiles } from '../server/src/authored.js';
import { initializeRoot, SCHEMA, WEB } from '../server/src/root.js';
import { createRuntime } from '../server/src/runtime.js';

for (const width of [1280, 390]) {
  test(`an empty installation creates its first bot and preserves it through restart at ${String(width)}px`, async ({
    page,
  }) => {
    const root = await mkdtemp(join(tmpdir(), 'simplebot-first-bot-'));
    const paths = {
      root,
      database: join(root, 'data/app.db'),
      schema: SCHEMA,
      web: WEB,
    };
    await initializeRoot(root, { tls: false });
    const config = await new AuthoredFiles(root).validateRequired();
    config.application.loginEnabled = false;
    config.providers = {};
    await writeFile(join(root, 'config.json'), JSON.stringify(config));
    let runtime = await createRuntime({ paths });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      const address = await runtime.app.listen({ host: '127.0.0.1', port: 0 });
      await page.setViewportSize({ width, height: 844 });
      await page.goto(address);
      await expect(page).toHaveTitle('SimpleBot');
      await expect(
        page.getByText(
          'This root has no bots yet. Create or import one from the drawer.',
        ),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: /^New conversation with /u }),
      ).toHaveCount(0);
      if (width === 390)
        await page
          .getByRole('button', { name: 'Open conversations', exact: true })
          .click();
      await page.getByRole('button', { name: 'New bot', exact: true }).click();
      const create = page.getByRole('dialog', { name: 'New bot', exact: true });
      await create.getByLabel('Bot name').fill('First bot');
      await create.getByRole('button', { name: 'Create bot' }).click();
      const panel = page.getByRole('dialog', {
        name: 'Bot settings',
        exact: true,
      });
      await expect(panel.getByLabel('Name', { exact: true })).toHaveValue(
        'First bot',
      );
      await panel
        .getByRole('button', { name: 'Close panel', exact: true })
        .click();
      const saved = await readFile(
        join(root, 'bots/first-bot/first-bot.json'),
        'utf8',
      );
      await runtime.close();
      await initializeRoot(root, { tls: false });
      runtime = await createRuntime({ paths });
      await runtime.app.listen({
        host: '127.0.0.1',
        port: Number(new URL(address).port),
      });
      await page.reload();
      if (width === 390)
        await page
          .getByRole('button', { name: 'Open conversations', exact: true })
          .click();
      await expect(
        page.getByRole('button', {
          name: 'New conversation with Help',
          exact: true,
        }),
      ).toHaveCount(0);
      await page
        .getByRole('button', {
          name: 'New conversation with First bot',
          exact: true,
        })
        .click();
      await expect(
        page.getByRole('textbox', { name: 'Message', exact: true }),
      ).toBeEnabled();
      await expect(page.locator('.msg-row')).toHaveCount(0);
      expect(
        await readFile(join(root, 'bots/first-bot/first-bot.json'), 'utf8'),
      ).toBe(saved);
      expect(errors).toEqual([]);
      await page.screenshot({
        path: resolve(`/tmp/simplebot-first-bot-${String(width)}.png`),
      });
    } finally {
      await runtime.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}
