import type { Api, Context, Model, Models } from '@earendil-works/pi-ai';

import type { AuthoredAttempt, AuthoredFiles } from './authored.js';
import { providerConnection } from './credentials.js';
import {
  StorageConflictError,
  StorageNotFoundError,
  type Storage,
} from './storage.js';
import { createPromptExpander } from './prompt-macros.js';

const SUMMARY_UNAVAILABLE =
  '[Summary unavailable. Retrieve details if needed.]';
export const SUMMARY_CLIPPED =
  '[Summary clipped. Retrieve omitted details if needed.]';

interface SummaryOptions {
  sessionId: string;
  storage: Storage;
  authored: AuthoredFiles;
  models: Models;
  signal: AbortSignal;
  now: () => Date;
}

interface Summary {
  summary: string;
  outcome: 'model' | 'fallback-clipped';
}

export async function compactSession(
  options: SummaryOptions & {
    /** Acceptance supplies saved prompt usage; omission means Compact now. */
    promptTokens?: number | null;
  },
): Promise<void> {
  if (options.promptTokens === null) return;
  const authored = await readSessionAuthored(options);
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
  let committed:
    | Summary
    | { summary: typeof SUMMARY_UNAVAILABLE; outcome: 'fallback-unavailable' };
  try {
    committed = await summarize(options, authored, leaf, startedAt);
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

/**
 * Operator-requested: summarize a committed leaf's range again from the
 * current canonical transcript and preset. A failure changes nothing and
 * reaches the caller; nothing retries.
 */
export async function regenerateLeaf(
  options: SummaryOptions & { leafId: string },
): Promise<void> {
  const authored = await readSessionAuthored(options);
  const leaf = options.storage.leafRegenerationInput(
    options.sessionId,
    options.leafId,
  );
  if (leaf.source.length === 0)
    throw new StorageConflictError('Nothing to summarize in this range');
  const result = await summarize(options, authored, leaf, options.now());
  options.storage.regenerateLeaf({
    sessionId: options.sessionId,
    leafId: options.leafId,
    summary: result.summary,
    summaryOutcome: result.outcome,
    now: options.now().toISOString(),
  });
}

async function readSessionAuthored(
  options: SummaryOptions,
): Promise<AuthoredAttempt> {
  const identity = options.storage.sessionIdentity(options.sessionId);
  if (identity === null) throw new StorageNotFoundError('Session not found');
  return options.authored.readAttempt(identity.botSlug, identity.presetSlug);
}

/** The one summary call. Throws when no usable summary comes back. */
async function summarize(
  options: SummaryOptions,
  authored: AuthoredAttempt,
  leaf: ReturnType<Storage['leafRegenerationInput']>,
  startedAt: Date,
): Promise<Summary> {
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
    // A hung summary call becomes an ordinary failure.
    timeoutMs: authored.config.application.modelCallTimeoutMs,
    maxRetries: 0,
    signal: options.signal,
  });
  for await (const _event of stream) {
    // The summary operation is deliberately quiet.
  }
  const message = await stream.result();
  if (message.stopReason !== 'stop')
    throw new Error(message.errorMessage ?? 'Summary call failed');
  const source = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
  if (source.length === 0) throw new Error('Summary call returned no text');
  return clipSummary(source, authored.preset.context.summaryLengthChars);
}

function clipSummary(source: string, limit: number): Summary {
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
