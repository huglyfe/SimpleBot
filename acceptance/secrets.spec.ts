import { expect, test } from '@playwright/test';
import {
  secretListSchema,
  settingsDocumentSchema,
} from '../shared/src/authored.js';

for (const width of [1280, 390]) {
  test(`saved secrets save independently, select references, and never reveal values at ${String(width)}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const original = settingsDocumentSchema.parse(
      await (await page.request.get('/api/settings')).json(),
    );
    const name = `BROWSER_SECRET_${String(width)}`;
    try {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/');
      await expect(page).toHaveTitle(/SimpleBot/u);
      const drawer = page.getByRole('button', {
        name: 'Open conversations',
        exact: true,
      });
      if (await drawer.isVisible()) await drawer.click();
      await page
        .getByRole('button', { name: 'Providers and keys', exact: true })
        .click();
      const panel = page.getByRole('dialog', {
        name: 'Providers & Keys settings',
      });
      await panel
        .getByRole('button', { name: 'Add secret', exact: true })
        .click();
      const add = page.getByRole('dialog', { name: 'Add secret', exact: true });
      await add.getByLabel('Secret name').fill(name);
      await add.getByLabel('Secret value').fill('synthetic-browser-secret');
      await add.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(add).toHaveCount(0);
      const metadataResponse = await page.request.get('/api/secrets');
      expect(await metadataResponse.text()).not.toContain(
        'synthetic-browser-secret',
      );
      expect(
        secretListSchema.parse(await metadataResponse.json()).names,
      ).toContain(name);
      const provider = Object.keys(original.value.providers)[0];
      if (provider === undefined) throw new Error('Missing fixture provider');
      await panel
        .getByRole('button', { name: `Edit ${provider}`, exact: true })
        .click();
      const editor = page.getByRole('dialog', {
        name: `Edit ${provider}`,
        exact: true,
      });
      await editor.getByLabel('API key reference source').selectOption('saved');
      await editor
        .getByLabel('API key reference', { exact: true })
        .selectOption(`secret:${name}`);
      await editor.getByRole('button', { name: 'Done', exact: true }).click();
      await panel.getByRole('button', { name: 'Save', exact: true }).click();
      await expect
        .poll(
          async () =>
            settingsDocumentSchema.parse(
              await (await page.request.get('/api/settings')).json(),
            ).value.providers[provider]?.apiKey,
        )
        .toBe(`secret:${name}`);
      await panel
        .getByRole('button', { name: `Replace secret ${name}`, exact: true })
        .click();
      const replacement = page.getByRole('dialog', {
        name: `Replace secret ${name}`,
        exact: true,
      });
      await expect(replacement.getByLabel('Secret value')).toHaveValue('');
      const box = await replacement.boundingBox();
      expect(box?.width).toBeLessThanOrEqual(width);
      await replacement
        .getByRole('button', { name: 'Discard', exact: true })
        .click();
      expect(errors).toEqual([]);
    } finally {
      const latest = settingsDocumentSchema.parse(
        await (await page.request.get('/api/settings')).json(),
      );
      await page.request.put('/api/settings', {
        data: { value: original.value, expectedRevision: latest.revision },
      });
      const secrets = secretListSchema.parse(
        await (await page.request.get('/api/secrets')).json(),
      );
      if (secrets.names.includes(name))
        await page.request.delete(`/api/secrets/${name}`, {
          data: { expectedRevision: secrets.revision },
        });
    }
  });
}
