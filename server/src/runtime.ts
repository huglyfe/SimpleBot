import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import type { MutableModels } from '@earendil-works/pi-ai';
import { join } from 'node:path';

import { createApp } from './app.js';
import { OwnerAuth } from './auth.js';
import { AttemptManager } from './attempts.js';
import type { AttemptEffect } from './assemble.js';
import { AuthoredFiles } from './authored.js';
import {
  activateCapabilities,
  type ActivatedCapabilities,
} from './capabilities.js';
import { SessionCron } from './cron.js';
import { McpCallUnresolvedError } from './mcp.js';
import { openStorage, type ExternalEffectOutcome } from './storage.js';
import { Speech } from './tts.js';

export interface RuntimePaths {
  root: string;
  database: string;
  schema: string;
  web?: string;
}

export async function createRuntime(options: {
  paths: RuntimePaths;
  config?: Awaited<ReturnType<AuthoredFiles['validateRequired']>>;
  models?: MutableModels;
  clock?: () => Date;
  tls?: { key: Buffer; cert: Buffer };
}) {
  const authored = new AuthoredFiles(options.paths.root);
  const config = options.config ?? (await authored.validateRequired());
  const storage = await openStorage(
    options.paths.database,
    options.paths.schema,
    join(options.paths.root, 'data', 'attachments'),
  );
  let resources: ActivatedCapabilities | undefined;
  try {
    const models = options.models ?? builtinModels();
    let capabilities = await activateCapabilities(authored, config);
    resources = capabilities;
    const auth = new OwnerAuth(storage.connection);
    const speech = new Speech(
      join(options.paths.root, 'data', 'tts'),
      storage,
      authored,
    );
    let cron: SessionCron | undefined;
    const attempts = new AttemptManager({
      storage,
      authored,
      capabilities: () => capabilities,
      models,
      schedulesChanged: (timezone) => cron?.wake(timezone),
      applyMemoryRetention: (effect, signal) =>
        applyMemoryRetention(capabilities, effect, signal),
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    });
    const scheduler = new SessionCron(
      storage,
      attempts,
      config.application.timezone,
      options.clock,
    );
    cron = scheduler;
    const app = createApp({
      storage,
      auth,
      authored,
      attempts,
      cron: scheduler,
      capabilities: () => capabilities,
      reloadDependencies: async () => {
        const next = await authored.readConfig();
        // Activate, swap, then close: a failed activation must not leave the
        // runtime pointing at a closed set.
        const activated = await activateCapabilities(authored, next.value);
        const previous = capabilities;
        previous.transferDockerOwnershipTo(activated);
        capabilities = activated;
        await previous.close();
      },
      speech,
      models,
      loginEnabled: config.application.loginEnabled,
      ...(options.paths.web === undefined
        ? {}
        : { webRoot: options.paths.web }),
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.tls === undefined ? {} : { tls: options.tls }),
    });
    let closed = false;

    return {
      app,
      attempts,
      cron: scheduler,
      auth,
      speech,
      storage,
      get capabilities() {
        return capabilities;
      },
      async close(): Promise<void> {
        if (closed) return;
        closed = true;
        scheduler.close();
        await attempts.close();
        try {
          await capabilities.close();
        } finally {
          try {
            await app.close();
          } finally {
            storage.close();
          }
        }
      },
    };
  } catch (error) {
    try {
      await resources?.close();
    } finally {
      storage.close();
    }
    throw error;
  }
}

export type Runtime = Awaited<ReturnType<typeof createRuntime>>;

async function applyMemoryRetention(
  capabilities: ActivatedCapabilities,
  effect: AttemptEffect,
  signal: AbortSignal,
): Promise<ExternalEffectOutcome> {
  try {
    if (effect.type.startsWith('mcp:')) {
      return {
        state: 'applied',
        result: await capabilities.call(
          effect.type.slice('mcp:'.length),
          effect.arguments,
          signal,
        ),
      };
    }
    return {
      state: 'failed',
      result: `Unknown external effect: ${effect.type}`,
    };
  } catch (error) {
    return {
      state: error instanceof McpCallUnresolvedError ? 'unresolved' : 'failed',
      result: error instanceof Error ? error.message : String(error),
    };
  }
}
