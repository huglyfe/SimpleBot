import type { Api, Context, Model, Models } from '@earendil-works/pi-ai';

import type { AuthoredFiles } from './authored.js';
import { providerConnection } from './credentials.js';
import type { Storage } from './storage.js';
import { createPromptExpander } from './prompt-macros.js';

const SUMMARY_UNAVAILABLE =
  '[Summary unavailable. Retrieve details if needed.]';
export const SUMMARY_CLIPPED =
  '[Summary clipped. Retrieve omitted details if needed.]';

export async function compactSession(options: {
  sessionId: string;
  storage: Storage;
  authored: AuthoredFiles;
  models: Models;
  signal: AbortSignal;
  now: () => Date;
  /** Acceptance supplies saved prompt usage; omission means Compact now. */
  promptTokens?: number | null;
}): Promise<void> {
  if (options.promptTokens === null) return;
  const identity = options.storage.sessionIdentity(options.sessionId);
  if (identity === null) throw new Error('Session not found');
  const authored = await options.authored.readAttempt(
    identity.botSlug,
    identity.presetSlug,
  );
  if (
    options.promptTokens !== undefined &&
    options.promptTokens < authored.preset.context.thresholdTokens
  )
    return;
  const startedAt = options.now();
  const leaf = options.storage.createPendingLeaf({
    sessionId: options.sessionId,
    liveTailExchanges: authored.preset.context.liveTailExchanges,
    now: startedAt.toISOString(),
  });
  if (leaf === null) return;
  // Assigned by exactly one of the two paths below: the summary call, or the
  // deterministic fallback.
  let committed:
    | { summary: string; outcome: 'model' | 'fallback-clipped' }
    | { summary: typeof SUMMARY_UNAVAILABLE; outcome: 'fallback-unavailable' };
  try {
    const reference = authored.preset.useMainModelForSummary
      ? authored.preset.mainModel
      : authored.preset.summaryModel;
    const configured = authored.config.providers[reference.provider];
    const sourceModel = options.models.getModel(
      reference.provider,
      reference.model,
    );
    if (configured === undefined || sourceModel === undefined) {
      throw new Error('Summary model is unavailable');
    }
    const connection = providerConnection(
      configured,
      reference.provider,
      options.authored.root,
    );
    const model: Model<Api> =
      connection.baseUrl === undefined
        ? { ...sourceModel }
        : { ...sourceModel, baseUrl: connection.baseUrl };
    const prior =
      leaf.priorLeafId === null
        ? null
        : options.storage.leafSummary(leaf.priorLeafId);
    const expand = createPromptExpander({
      bot: authored.writing.name,
      user: authored.preset.persona.name,
      model: model.id,
      now: startedAt,
      timezone: authored.config.application.timezone,
      previousUserMessageAt: options.storage.previousUserMessageAt(
        options.sessionId,
        leaf.triggerPositionId,
      ),
      variables: options.storage.sessionVariables(options.sessionId),
      todos: options.storage.listTodos(options.sessionId),
    });
    const context: Context = {
      systemPrompt: expand(authored.preset.prompts.summarization),
      messages: [
        {
          role: 'user',
          content: [
            `Bot: ${expand(authored.writing.name)}`,
            `Bot description:\n${expand(authored.writing.description)}`,
            `Scenario:\n${expand(authored.writing.scenario)}`,
            `User persona (${expand(authored.preset.persona.name)}):\n${expand(authored.preset.persona.description)}`,
            `Previous leaf (continuity reference only; do not summarize or restate):\n${prior === '' ? '<empty_summary/>' : (prior ?? '(none)')}`,
            `New transcript to summarize:\n${leaf.source}`,
          ].join('\n\n'),
          timestamp: startedAt.getTime(),
        },
      ],
    };
    const stream = options.models.streamSimple(model, context, {
      ...(connection.apiKey === undefined ? {} : { apiKey: connection.apiKey }),
      ...(authored.preset.summaryEffort === 'off'
        ? {}
        : { reasoning: authored.preset.summaryEffort }),
      // A hung summary becomes the ordinary fallback below.
      timeoutMs: authored.config.application.modelCallTimeoutMs,
      maxRetries: 0,
      signal: options.signal,
    });
    for await (const _event of stream) {
      // The summary operation is deliberately quiet.
    }
    const message = await stream.result();
    if (message.stopReason !== 'stop') throw new Error('Summary call failed');
    const source = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
    if (source.length === 0) throw new Error('Summary call returned no text');
    committed = clipSummary(source, authored.preset.context.summaryLengthChars);
  } catch {
    committed = {
      summary: SUMMARY_UNAVAILABLE,
      outcome: 'fallback-unavailable',
    };
  }
  options.storage.commitLeaf(
    leaf.id,
    committed.summary,
    committed.outcome,
    options.now().toISOString(),
  );
}

function clipSummary(
  source: string,
  limit: number,
): { summary: string; outcome: 'model' | 'fallback-clipped' } {
  if (source.length <= limit) return { summary: source, outcome: 'model' };
  const prefix = source.slice(
    0,
    Math.max(0, limit - SUMMARY_CLIPPED.length - 1),
  );
  return {
    summary: `${prefix.trimEnd()}\n${SUMMARY_CLIPPED}`,
    outcome: 'fallback-clipped',
  };
}
