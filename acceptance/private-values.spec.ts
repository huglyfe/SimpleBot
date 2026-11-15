import { expect, test } from '@playwright/test';
import { settingsDocumentSchema } from '../shared/src/authored.js';

for (const width of [1280, 390]) {
  test(`private values save with the panel, overwrite, and never reveal values at ${String(width)}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const settings = async () =>
      settingsDocumentSchema.parse(
        await (await page.request.get('/api/settings')).json(),
      );
    const original = await settings();
    const provider = Object.keys(original.value.providers)[0];
    if (provider === undefined) throw new Error('Missing fixture provider');
    try {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/');
      await expect(page).toHaveTitle(/SimpleBot/u);
      if (width === 390)
        await page
          .getByRole('button', { name: 'Open conversations', exact: true })
          .click();
      await page
        .getByRole('button', { name: 'Providers and keys', exact: true })
        .click();
      const panel = page.getByRole('dialog', {
        name: 'Providers & Keys settings',
      });
      const saveKey = async (value: string) => {
        await panel
          .getByRole('button', { name: `Edit ${provider}`, exact: true })
          .click();
        const editor = page.getByRole('dialog', {
          name: `Edit ${provider}`,
          exact: true,
        });
        await editor.getByLabel('API key source').selectOption('private');
        const input = editor.getByLabel('API key', { exact: true });
        await expect(input).toHaveAttribute('type', 'password');
        await expect(input).toHaveValue('');
        const box = await editor.boundingBox();
        expect(box?.width).toBeLessThanOrEqual(width);
        await input.fill(value);
        await editor.getByRole('button', { name: 'Done', exact: true }).click();
        await panel.getByRole('button', { name: 'Save', exact: true }).click();
      };
      await saveKey('synthetic-browser-one');
      await expect
        .poll(async () => (await settings()).value.providers[provider]?.apiKey)
        .toEqual({ private: expect.stringMatching(/^[a-f0-9]{32}$/u) });
      const first = (await settings()).value.providers[provider]?.apiKey;
      await saveKey('synthetic-browser-two');
      await expect
        .poll(async () => (await settings()).value.providers[provider]?.apiKey)
        .not.toEqual(first);
      expect(
        await (await page.request.get('/api/settings')).text(),
      ).not.toContain('synthetic-browser');
      expect(errors).toEqual([]);
    } finally {
      const latest = await settings();
      await page.request.put('/api/settings', {
        data: { value: original.value, expectedRevision: latest.revision },
      });
    }
  });
}
