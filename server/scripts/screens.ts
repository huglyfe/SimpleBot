/**
 * Reproducible UI screenshots for visual review: `pnpm screens [label]`.
 *
 * Starts a disposable faux-provider runtime with the built WebUI, creates a
 * synthetic demo bot, plays two example turns, and captures each surface
 * into the ignored `.ui-screens/<label>/` directory. Run `pnpm build` first.
 * Set SCREENS_CHROMIUM_ARGS (space-separated) for hosts that need extra
 * Chromium flags.
 */
import { chromium } from '@playwright/test';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
} from '@earendil-works/pi-ai';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  createTestFixture,
  disposeTestFixture,
  listen,
} from '../src/test-helper.js';

const repo = resolve(import.meta.dirname, '../..');
const out = resolve(repo, '.ui-screens', process.argv[2] ?? 'latest');
const REPLY = `Here is a simple plan for the demo project:

- Write down the goal.
- Build one small example.
- Check the result.

**Next step:** choose the example you want to try. _Keep it small enough to finish today._`;

const fixture = await createTestFixture({
  faux: fauxProvider({
    provider: 'anthropic',
    models: [
      { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', reasoning: true },
    ],
  }),
  web: resolve(repo, 'web/dist'),
});
let call = 0;
fixture.faux.setResponses(
  Array.from({ length: 8 }, () => () => {
    call += 1;
    return call === 1
      ? fauxAssistantMessage([
          fauxThinking('Arrange the demo steps in a useful order.'),
          fauxText(REPLY),
        ])
      : fauxAssistantMessage([fauxText(REPLY)]);
  }),
);

const browser = await chromium.launch({
  args: process.env.SCREENS_CHROMIUM_ARGS?.split(' ').filter(Boolean) ?? [],
});
try {
  const url = await listen(fixture.runtime);
  await mkdir(out, { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  const shot = (name: string) =>
    page.screenshot({ path: `${out}/${name}.png`, animations: 'disabled' });
  const panel = async (opener: string, name: string) => {
    await page.getByRole('button', { name: opener, exact: true }).click();
    await page.getByRole('dialog').last().waitFor();
    await page.getByText(/^Loading/u).waitFor({ state: 'detached' });
    await shot(name);
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
  };

  await page.goto(url);
  await shot('01-start');
  await page.getByRole('button', { name: 'New bot', exact: true }).click();
  await page.getByLabel('Bot name').fill('Demo Assistant');
  await page.getByRole('button', { name: 'Create bot' }).click();
  await page.getByRole('dialog', { name: 'Bot settings' }).waitFor();
  await shot('02-bot');
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: 'New conversation with Demo Assistant' })
    .click();
  const message = page.getByRole('textbox', { name: 'Message', exact: true });
  for (const text of [
    'Help me plan a small demo project.',
    'What should I do first?',
  ]) {
    await message.fill(text);
    await page.keyboard.press('ControlOrMeta+Enter');
    await page.getByLabel('Stop response').waitFor();
    await page.getByLabel('Stop response').waitFor({ state: 'detached' });
  }
  await shot('03-conversation');
  await panel('Conversation controls', '04-conversation-controls');
  await panel('Preset settings', '05-preset');
  await page.getByRole('button', { name: 'Preset settings' }).click();
  await page.getByRole('button', { name: /^Edit System/u }).click();
  await page.getByRole('dialog').nth(1).waitFor();
  await shot('06-focused-editor');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await panel('Providers and keys', '07-providers');
  await panel('Capabilities', '08-capabilities');
  await panel('Application settings', '09-application');
  await page.emulateMedia({ colorScheme: 'light' });
  await shot('10-conversation-light');
  await panel('Preset settings', '11-preset-light');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot('12-phone');
  await page.getByRole('button', { name: 'Open conversations' }).click();
  await shot('13-phone-drawer');
  console.log(`Screens written to ${out}`);
} finally {
  await browser.close();
  await disposeTestFixture(fixture);
}
