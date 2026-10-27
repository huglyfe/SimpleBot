import { randomUUID } from 'node:crypto';

import { isContextOverflow } from '@earendil-works/pi-ai';
import type {
  AssistantMessage,
  Models,
  ToolCall,
  ToolResultMessage,
  Usage,
} from '@earendil-works/pi-ai';
import {
  NO_RESPONSE,
  appendSystemError,
  promptTokenCount,
  updateTrace,
  type Trace,
} from '@simplebot/shared';
import type {
  AttemptEvent,
  AttemptEventPayload as LiveAttemptEvent,
} from '@simplebot/shared';
import { Value } from 'typebox/value';

import {
  assembleAttempt,
  commandSource,
  type EngineAttemptCommand,
  type AttemptEffect,
  type AttemptAssembly,
} from './assemble.js';
import type { AuthoredFiles } from './authored.js';
import type { ActivatedCapabilities } from './capabilities.js';
import { compactSession } from './continuity.js';
import type { ExternalEffectOutcome, Storage } from './storage.js';

interface Attempt {
  id: string;
  sessionId: string;
  command: EngineAttemptCommand;
  emit: (event: AttemptEvent) => void;
  controller: AbortController;
  admitted: { positionId: string; variantId: string } | null;
  finish(): void;
}

interface Generation {
  source: string;
  trace: Trace;
  usages: (Usage | null)[];
  effects: AttemptEffect[];
  provider: string;
  model: string;
}

type EffectOperation =
  | { kind: 'compact'; sessionId: string }
  | { kind: 'accept'; sessionId: string; positionId: string };

export interface AttemptManagerOptions {
  storage: Storage;
  authored: AuthoredFiles;
  capabilities: () => ActivatedCapabilities;
  models: Models;
  applyMemoryRetention: (
    effect: AttemptEffect,
    signal: AbortSignal,
  ) => Promise<ExternalEffectOutcome>;
  schedulesChanged: (timezone: string) => void;
  clock?: () => Date;
}

/** One global ingress FIFO and one global effect FIFO. */
export class AttemptManager {
  readonly #options: AttemptManagerOptions;
  readonly #attempts = new Map<string, Attempt>();
  #ingressTail: Promise<void> = Promise.resolve();
  #effectTail: Promise<void> = Promise.resolve();
  /** Aborted on close, so a hung external call cannot outlive the process. */
  readonly #shutdown = new AbortController();

  constructor(options: AttemptManagerOptions) {
    this.#options = options;
  }

  enqueue(input: {
    id?: string;
    sessionId: string;
    command: EngineAttemptCommand;
    emit: (event: AttemptEvent) => void;
  }): { id: string; done: Promise<void> } {
    if (this.#shutdown.signal.aborted) throw new Error('Runtime is closing');
    const id = input.id ?? randomUUID();
    const { promise: done, resolve } = Promise.withResolvers<undefined>();
    const attempt: Attempt = {
      id,
      sessionId: input.sessionId,
      command: Object.freeze(input.command),
      emit: input.emit,
      controller: new AbortController(),
      admitted: null,
      finish: () => resolve(undefined),
    };
    this.#attempts.set(id, attempt);
    this.#emit(attempt, { type: 'queued' });
    const run = this.#ingressTail.then(() => this.#run(attempt));
    this.#ingressTail = run.catch(() => undefined);
    return { id, done };
  }

  /** A disposable view of queued or admitted work for this session. */
  activeAttemptId(sessionId: string): string | null {
    for (const attempt of this.#attempts.values()) {
      if (attempt.sessionId === sessionId) return attempt.id;
    }
    return null;
  }

  cancel(sessionId: string, attemptId: string): boolean {
    const attempt = this.#attempts.get(attemptId);
    if (attempt?.sessionId !== sessionId) return false;
    attempt.controller.abort();
    if (attempt.admitted === null) this.#settle(attempt);
    return true;
  }

  async acceptPosition(sessionId: string, positionId: string): Promise<void> {
    await this.#enqueueEffect({ kind: 'accept', sessionId, positionId });
  }

  async requestCompaction(sessionId: string): Promise<void> {
    await this.#enqueueEffect({ kind: 'compact', sessionId });
  }

  async close(): Promise<void> {
    for (const attempt of this.#attempts.values()) attempt.controller.abort();
    this.#shutdown.abort();
    await Promise.all([this.#ingressTail, this.#effectTail]);
  }

  async #run(attempt: Attempt): Promise<void> {
    const signal = attempt.controller.signal;
    const generation: Generation = {
      source: '',
      trace: [],
      usages: [],
      effects: [],
      provider: 'system',
      model: 'error',
    };
    try {
      const effectBarrier = this.#effectTail;
      await effectBarrier;
      signal.throwIfAborted();
      if (attempt.command.kind !== 'swipe') {
        const prior = this.#options.storage.unlockedFinalAssistantPosition(
          attempt.sessionId,
        );
        if (prior !== null) await this.acceptPosition(attempt.sessionId, prior);
      }
      signal.throwIfAborted();
      const admitted = this.#options.storage.admitAttempt({
        sessionId: attempt.sessionId,
        target:
          attempt.command.kind === 'swipe'
            ? { kind: 'swipe', positionId: attempt.command.positionId }
            : {
                kind: 'reply',
                source: commandSource(attempt.command),
                ...(attempt.command.kind === 'reply' &&
                attempt.command.attachmentIds !== undefined
                  ? { attachmentIds: attempt.command.attachmentIds }
                  : {}),
              },
        variantId: randomUUID(),
        now: this.#now().toISOString(),
      });
      attempt.admitted = admitted;
      this.#emit(attempt, { type: 'admitted', ...admitted });
      const assembly = await assembleAttempt({
        sessionId: attempt.sessionId,
        ...admitted,
        storage: this.#options.storage,
        authored: this.#options.authored,
        capabilities: this.#options.capabilities(),
        models: this.#options.models,
        now: this.#now(),
        signal,
      });
      generation.provider = assembly.model.provider;
      generation.model = assembly.model.id;
      await runModelLoop(
        assembly,
        generation,
        signal,
        (event) => {
          if (event.type === 'text_delta') generation.source += event.delta;
          generation.trace = updateTrace(
            generation.trace,
            this.#emit(attempt, event),
          );
        },
        this.#now.bind(this),
      );
      signal.throwIfAborted();
      if (
        assembly.memoryRetain !== null &&
        assembly.memoryUserSource.length > 0
      ) {
        generation.effects.push({
          type: `mcp:${assembly.memoryRetain}`,
          arguments: {
            bot: assembly.botSlug,
            session: attempt.sessionId,
            text: `User: ${assembly.memoryUserSource}\nAssistant: ${generation.source}`,
            at: this.#now().toISOString(),
          },
        });
      }
      if (
        attempt.command.kind === 'scheduled' &&
        generation.source.trim() === 'no_response'
      )
        generation.source = NO_RESPONSE;
      this.#completeAdmitted(attempt, generation);
      this.#settle(attempt, { type: 'completed', ...admitted });
    } catch (error) {
      if (attempt.admitted === null) {
        this.#settle(attempt);
        return;
      }
      generation.source = appendSystemError(
        generation.source,
        signal.aborted
          ? 'Generation stopped by operator.'
          : errorMessage(error),
      );
      try {
        this.#completeAdmitted(attempt, generation);
        this.#settle(attempt, { type: 'completed', ...attempt.admitted });
      } catch {
        this.#settle(attempt);
      }
    } finally {
      if (attempt.command.kind === 'reply')
        await this.#options.storage.discardUnboundAttachments(
          attempt.sessionId,
          attempt.command.attachmentIds ?? [],
        );
    }
  }

  #completeAdmitted(attempt: Attempt, generation: Generation): void {
    const admitted = attempt.admitted;
    if (admitted === null) throw new Error('Attempt was not admitted');
    this.#options.storage.finalizeVariant({
      sessionId: attempt.sessionId,
      ...admitted,
      source: generation.source,
      trace: generation.trace,
      usages: generation.usages,
      provider: generation.provider,
      model: generation.model,
      effects: generation.effects,
      completedAt: this.#now().toISOString(),
    });
  }

  #settle(attempt: Attempt, event?: LiveAttemptEvent): void {
    if (!this.#attempts.delete(attempt.id)) return;
    if (event !== undefined) this.#emit(attempt, event);
    attempt.finish();
  }

  #emit(attempt: Attempt, event: LiveAttemptEvent): AttemptEvent {
    const emitted = {
      ...event,
      attemptId: attempt.id,
      at: this.#now().toISOString(),
    };
    attempt.emit(emitted);
    return emitted;
  }

  #now(): Date {
    return this.#options.clock?.() ?? new Date();
  }

  #enqueueEffect(operation: EffectOperation): Promise<void> {
    if (this.#shutdown.signal.aborted)
      return Promise.reject(new Error('Runtime is closing'));
    const result = this.#effectTail.then(() => this.#runEffect(operation));
    this.#effectTail = result.catch(() => undefined);
    return result;
  }

  async #runEffect(operation: EffectOperation): Promise<void> {
    const { sessionId } = operation;
    let promptTokens: number | null | undefined;
    if (operation.kind === 'accept') {
      const timezone = (await this.#options.authored.readConfig()).value
        .application.timezone;
      const usage = this.#options.storage.acceptPosition(
        sessionId,
        operation.positionId,
        this.#now().toISOString(),
      );
      promptTokens = usage === null ? null : promptTokenCount(usage);
      const schedulesChanged = await this.#options.storage.drainEffects(
        sessionId,
        this.#now().toISOString(),
        timezone,
        (type, arguments_) =>
          this.#options.applyMemoryRetention(
            { type, arguments: arguments_ },
            this.#shutdown.signal,
          ),
      );
      if (schedulesChanged) this.#options.schedulesChanged(timezone);
    }
    await compactSession({
      sessionId,
      storage: this.#options.storage,
      authored: this.#options.authored,
      models: this.#options.models,
      signal: this.#shutdown.signal,
      now: this.#now.bind(this),
      ...(promptTokens === undefined ? {} : { promptTokens }),
    });
  }
}

async function runModelLoop(
  assembly: AttemptAssembly,
  generation: Generation,
  signal: AbortSignal,
  emit: (event: LiveAttemptEvent) => void,
  now: () => Date,
): Promise<void> {
  const contextMessages = [...assembly.context.messages];
  let modelCalls = 0;
  let toolCalls = 0;
  let toolResultChars = 0;
  while (true) {
    signal.throwIfAborted();
    modelCalls += 1;
    if (modelCalls > assembly.limits.maxModelCalls)
      throw new Error('Model call limit exceeded');
    const priorSource = generation.source;
    const stream = assembly.models.streamSimple(
      assembly.model,
      { ...assembly.context, messages: contextMessages },
      { ...assembly.streamOptions, signal },
    );
    for await (const event of stream) {
      if (event.type === 'text_delta')
        emit({ type: 'text_delta', delta: event.delta });
      else if (event.type === 'thinking_delta')
        emit({ type: 'thinking_delta', delta: event.delta });
      else if (event.type === 'toolcall_end')
        emit({
          type: 'tool_call',
          id: event.toolCall.id,
          name: event.toolCall.name,
          arguments: event.toolCall.arguments,
        });
    }
    const providerMessage = await stream.result();
    generation.provider = providerMessage.provider;
    generation.model = providerMessage.model;
    contextMessages.push(providerMessage);
    generation.usages.push(knownUsage(providerMessage.usage));
    if (attemptContextOverflow(providerMessage, assembly.model.contextWindow))
      throw new Error('Context window exceeded');
    if (providerMessage.stopReason === 'aborted')
      throw new Error('Generation stopped.');
    if (providerMessage.stopReason === 'error')
      throw new Error(providerMessage.errorMessage ?? 'Provider failed');
    if (providerMessage.stopReason === 'length')
      throw new Error('Provider response reached its length limit');
    if (
      providerMessage.stopReason === 'deferred' ||
      providerMessage.stopReason === 'pending'
    )
      throw new Error(
        `Unsupported provider stop: ${providerMessage.stopReason}`,
      );
    const calls = providerMessage.content.filter(
      (block): block is ToolCall => block.type === 'toolCall',
    );
    if (providerMessage.stopReason !== 'toolUse') {
      const source = providerMessage.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
      if (source.length === 0) throw new Error('Provider returned no text');
      generation.source = priorSource + source;
      return;
    }
    if (calls.length === 0)
      throw new Error('Provider returned toolUse without a tool call');
    for (const call of calls) {
      signal.throwIfAborted();
      toolCalls += 1;
      if (toolCalls > assembly.limits.maxToolCalls)
        throw new Error('Tool call limit exceeded');
      const tool = assembly.tools.find(
        (candidate) => candidate.name === call.name,
      );
      let result: string;
      let isError = false;
      if (tool === undefined) {
        result = `Unknown tool: ${call.name}`;
        isError = true;
      } else if (!Value.Check(tool.parameters, call.arguments)) {
        result = `Invalid arguments for ${call.name}`;
        isError = true;
      } else {
        try {
          const execution = await tool.execute(call.arguments, signal);
          if (typeof execution === 'string') result = execution;
          else {
            generation.effects.push(execution);
            result = `Effect pending acceptance${typeof execution.arguments.id === 'string' ? `: ${execution.arguments.id}` : ''}`;
          }
        } catch (error) {
          if (signal.aborted)
            throw new Error('Generation stopped.', { cause: error });
          result = errorMessage(error);
          isError = true;
        }
      }
      result = result.slice(0, assembly.limits.maxToolResultChars);
      toolResultChars += result.length;
      if (toolResultChars > assembly.limits.maxToolResultCharsTotal)
        throw new Error('Total tool result limit exceeded');
      const toolResult: ToolResultMessage = {
        role: 'toolResult',
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: 'text', text: result }],
        isError,
        timestamp: now().getTime(),
      };
      contextMessages.push(toolResult);
      emit({
        type: 'tool_result',
        id: call.id,
        name: call.name,
        result,
        isError,
      });
    }
  }
}

function knownUsage(usage: Usage): Usage | null {
  return usage.input === 0 &&
    usage.output === 0 &&
    usage.cacheRead === 0 &&
    usage.cacheWrite === 0 &&
    usage.totalTokens === 0
    ? null
    : structuredClone(usage);
}

/** `pi-ai` owns provider error patterns; SimpleBot owns exact prompt accounting. */
export function attemptContextOverflow(
  message: AssistantMessage,
  contextWindow: number,
): boolean {
  if (isContextOverflow(message)) return true;
  const promptTokens = promptTokenCount(message.usage);
  if (message.stopReason === 'stop') return promptTokens > contextWindow;
  return (
    message.stopReason === 'length' &&
    message.usage.output === 0 &&
    promptTokens >= contextWindow * 0.99
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
