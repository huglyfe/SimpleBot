/** Disposable production-shaped runtime for black-box browser acceptance. */
import {
  fauxAssistantMessage,
  getCurrentSystemPrompt,
  fauxThinking,
  fauxText,
  fauxToolCall,
  fauxProvider,
  type Context,
  type FauxResponseStep,
} from '@earendil-works/pi-ai';
import { unknownRecordSchema } from '@simplebot/shared';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createTestFixture, disposeTestFixture } from '../src/test-helper.js';

const port = Number.parseInt(process.env.PORT ?? '4173', 10);
const loginEnabled = process.env.AUTH_ENABLED === 'true';
const ownerKey = process.env.ACCEPTANCE_OWNER_KEY;
const fixture = await createTestFixture({
  faux: fauxProvider({
    provider: 'faux-acceptance',
    models: [
      { id: 'faux-default', name: 'Faux default', reasoning: true },
      { id: 'faux-low', name: 'Faux low', reasoning: true },
    ],
  }),
  web: resolve(import.meta.dirname, '../../web/dist'),
  loginEnabled,
});

// The second model exercises switching to a model whose minimum is above off.
const lowModel = fixture.faux.getModel('faux-low');
if (lowModel === undefined) throw new Error('Missing low-effort fixture model');
lowModel.thinkingLevelMap = {
  off: null,
  minimal: null,
};

const presetPath = resolve(fixture.root, 'presets/default.json');
const preset = unknownRecordSchema.parse(
  JSON.parse(await readFile(presetPath, 'utf8')),
);
preset.context = {
  thresholdTokens: 100_000,
  liveTailExchanges: 1,
  activeLeafCap: 5,
  summaryLengthChars: 6_000,
};
await writeFile(presetPath, JSON.stringify(preset));

if (loginEnabled) {
  if (ownerKey === undefined)
    throw new Error('Acceptance owner key is required');
  fixture.runtime.auth.setOwnerKey(ownerKey);
}

function lastUserText(context: Context): string {
  for (let index = context.messages.length - 1; index >= 0; index--) {
    const message = context.messages[index];
    if (message?.role !== 'user') continue;
    if (typeof message.content === 'string') return message.content;
    return message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('\n');
  }
  return '';
}

/** Leaves enough time to remount Context while the leaf is pending. */
const SLOW_SUMMARY_MS = 2_000;

const promptCalls = new Map<string, number>();
let ordinaryReply = 0;
const scriptedResponse: FauxResponseStep = async (context) => {
  const prompt = lastUserText(context);
  if (
    getCurrentSystemPrompt(context.messages).includes('Summarize') &&
    prompt.includes('Slow compaction evidence')
  ) {
    await new Promise((resolve) => setTimeout(resolve, SLOW_SUMMARY_MS));
    return fauxAssistantMessage('Summary of the slow compaction evidence.');
  }
  if (
    getCurrentSystemPrompt(context.messages).includes('Summarize') &&
    prompt.includes('Regenerated evidence')
  ) {
    return fauxAssistantMessage('Summary regenerated from edited history.');
  }
  if (
    getCurrentSystemPrompt(context.messages).includes('Summarize') &&
    prompt.includes('Fallback evidence')
  ) {
    return fauxAssistantMessage('', {
      stopReason: 'error',
      errorMessage: 'Scripted summary failure.',
    });
  }
  const ordinal = (promptCalls.get(prompt) ?? 0) + 1;
  promptCalls.set(prompt, ordinal);
  if (prompt.includes('Acceptance background response')) {
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    return fauxAssistantMessage('Finished in the background.');
  }
  if (prompt.includes('Acceptance ordered trace')) {
    const variant = Math.ceil(ordinal / 2);
    if (ordinal % 2 === 1)
      return fauxAssistantMessage(
        [
          fauxThinking(`Trace ${String(variant)} before.`),
          fauxToolCall(
            'system__calculator',
            { expression: '2+2' },
            { id: 'calculation' },
          ),
          fauxThinking(`Trace ${String(variant)} between.`),
          fauxToolCall('system__wall_clock', {}, { id: 'clock' }),
        ],
        { stopReason: 'toolUse' },
      );
    // Keep the completed tool rows visible in the live overlay before the answer.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    return fauxAssistantMessage([
      fauxThinking(`Trace ${String(variant)} after.`),
      fauxText(`Ordered answer ${String(variant)}.`),
    ]);
  }
  if (prompt.includes('Acceptance todo effects')) {
    if (ordinal % 2 === 1)
      return fauxAssistantMessage(
        [
          fauxToolCall('system__todo_add', {
            title: 'Model deadline',
            due: '2026-10-23T15:45',
          }),
          fauxToolCall('system__variable_set', {
            name: 'progress',
            value: 'started',
          }),
        ],
        { stopReason: 'toolUse' },
      );
    return fauxAssistantMessage('Acceptance reply with proposed changes.');
  }
  if (prompt.includes('Acceptance swipe lifecycle')) {
    if (ordinal === 1) return fauxAssistantMessage('First swipe variant.');
    if (ordinal === 2) return fauxAssistantMessage('Second swipe variant.');
    if (ordinal === 3)
      return fauxAssistantMessage('', {
        stopReason: 'error',
        errorMessage: 'Scripted swipe failure.',
      });
    return fauxAssistantMessage('Recovered swipe variant.');
  }
  ordinaryReply += 1;
  return fauxAssistantMessage(`Acceptance reply ${String(ordinaryReply)}`);
};

fixture.faux.setResponses(Array.from({ length: 128 }, () => scriptedResponse));

await fixture.runtime.app.listen({ host: '127.0.0.1', port });

async function close(): Promise<void> {
  await disposeTestFixture(fixture);
  process.exit(0);
}
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
