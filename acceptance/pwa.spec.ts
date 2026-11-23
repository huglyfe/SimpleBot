import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createTestFixture } from '../server/src/test-helper.js';

test('a second build takes over an open page automatically and replaces only its own shell cache', async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  const temporary = await mkdtemp(join(tmpdir(), 'simplebot-pwa-'));
  const web = join(temporary, 'web');
  await cp(resolve('web/dist'), web, { recursive: true });
  const fixture = await createTestFixture({ web });
  try {
    const url = await fixture.runtime.app.listen({
      host: '127.0.0.1',
      port: 0,
    });
    // The first install takes control of the fresh page without reloading it.
    let loads = 0;
    page.on('load', () => (loads += 1));
    await page.goto(url);
    await expect(page).toHaveTitle('SimpleBot');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      await caches.open('unrelated-cache');
    });
    await expect
      .poll(() =>
        page.evaluate(() => navigator.serviceWorker.controller !== null),
      )
      .toBe(true);
    const cdp = await context.newCDPSession(page);
    const installability: unknown = await cdp.send(
      'Page.getInstallabilityErrors',
    );
    expect(installability).toEqual({ installabilityErrors: [] });
    await cdp.detach();
    await page
      .getByRole('button', { name: 'New conversation with Echo' })
      .click();
    const message = page.getByRole('textbox', { name: 'Message', exact: true });
    expect(loads).toBe(1);
    await message.fill('An open page reloads onto the new build');
    const oldCaches = await page.evaluate(() => caches.keys());

    // Build a real second release into the isolated server's static root.
    // Only the test adds a visible title marker; the shipping build owns SW revisioning.
    const config = join(temporary, 'vite.config.mjs');
    await writeFile(
      config,
      `import config from ${JSON.stringify(pathToFileURL(resolve('web/vite.config.ts')).href)};
export default (env) => {
  const base = config(env);
  return { ...base, plugins: [...base.plugins, {
    name: 'acceptance-version',
    transformIndexHtml: (html) => html.replace('<title>SimpleBot</title>', '<title>SimpleBot updated</title>'),
  }] };
};`,
    );
    await promisify(execFile)(
      process.execPath,
      [
        resolve('web/node_modules/vite/bin/vite.js'),
        'build',
        '--config',
        config,
        '--outDir',
        web,
        '--emptyOutDir',
      ],
      { cwd: resolve('web') },
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.ready).update();
    });
    await expect(page).toHaveTitle('SimpleBot updated');
    await expect(message).toHaveValue(
      'An open page reloads onto the new build',
    );
    const newCaches = await page.evaluate(() => caches.keys());
    expect(newCaches).toContain('unrelated-cache');
    expect(
      newCaches.filter((key) => key.startsWith('simplebot-shell-')),
    ).toHaveLength(1);
    expect(newCaches).not.toEqual(oldCaches);
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.locator('.msg-row.is-user').last()).toContainText(
      'An open page reloads onto the new build',
    );
    await page.reload();
    await expect(message).toHaveValue('');
    await context.setOffline(true);
    await page.reload();
    await expect(page).toHaveTitle('SimpleBot updated');
    await expect(page.getByText(/Could not reach SimpleBot/u)).toBeVisible();
  } finally {
    await context.setOffline(false);
    await fixture.runtime.close();
    await rm(fixture.root, { recursive: true, force: true });
    await rm(temporary, { recursive: true, force: true });
  }
});
