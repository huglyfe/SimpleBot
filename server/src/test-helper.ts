import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createModels,
  fauxProvider,
  type FauxProviderHandle,
  type MutableModels,
} from '@earendil-works/pi-ai';

import { createRuntime, type Runtime } from './runtime.js';
import { SYSTEM_TOOL_DEFINITIONS } from './assemble-tools.js';

export interface TestFixture {
  root: string;
  models: MutableModels;
  faux: FauxProviderHandle;
  runtime: Runtime;
}

let fixtureOrdinal = 0;

export async function createTestFixture(options?: {
  faux?: FauxProviderHandle;
  clock?: () => Date;
  web?: string;
  loginEnabled?: boolean;
}): Promise<TestFixture> {
  const root = await mkdtemp(join(tmpdir(), 'simplebot-test-'));
  const faux =
    options?.faux ??
    fauxProvider({ provider: `faux-${String((fixtureOrdinal += 1))}` });
  const models = createModels();
  models.setProvider(faux.provider);
  await writeAuthoredRoot(
    root,
    faux.provider.id,
    faux.getModel().id,
    options?.loginEnabled ?? false,
  );
  const runtime = await createRuntime({
    paths: {
      root,
      database: join(root, 'data', 'app.db'),
      schema: fileURLToPath(new URL('../schema.sql', import.meta.url)),
      ...(options?.web === undefined ? {} : { web: options.web }),
    },
    models,
    ...(options?.clock === undefined ? {} : { clock: options.clock }),
  });
  return { root, models, faux, runtime };
}

/** Close owned resources before removing a disposable root. Restart tests close separately. */
export async function disposeTestFixture(
  fixture: Pick<TestFixture, 'root' | 'runtime'>,
): Promise<void> {
  try {
    await fixture.runtime.close();
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

export async function reopenTestFixture(input: {
  root: string;
  faux: FauxProviderHandle;
}): Promise<Pick<TestFixture, 'models' | 'runtime'>> {
  const models = createModels();
  models.setProvider(input.faux.provider);
  const runtime = await createRuntime({
    paths: {
      root: input.root,
      database: join(input.root, 'data', 'app.db'),
      schema: fileURLToPath(new URL('../schema.sql', import.meta.url)),
    },
    models,
  });
  return { models, runtime };
}

/**
 * One admitted and completed exchange. Provenance defaults to the fixture's
 * faux provider.
 */
export function seedExchange(
  fixture: Pick<TestFixture, 'faux' | 'runtime'>,
  input: {
    sessionId: string;
    user: string;
    assistant: string;
    now: string;
    attachmentIds?: readonly string[];
    effects?: readonly { type: string; arguments: Record<string, unknown> }[];
    lock?: boolean;
    usages?: readonly (import('@earendil-works/pi-ai').Usage | null)[];
    faux?: FauxProviderHandle;
  },
): { positionId: string; variantId: string } {
  const faux = input.faux ?? fixture.faux;
  const admitted = fixture.runtime.storage.admitAttempt({
    sessionId: input.sessionId,
    target: {
      kind: 'reply',
      source: input.user,
      ...(input.attachmentIds === undefined
        ? {}
        : { attachmentIds: input.attachmentIds }),
    },
    variantId: randomUUID(),
    now: input.now,
  });
  fixture.runtime.storage.finalizeVariant({
    sessionId: input.sessionId,
    ...admitted,
    source: input.assistant,
    trace: [],
    usages: input.usages ?? [],
    provider: faux.provider.id,
    model: faux.getModel().id,
    ...(input.effects === undefined ? {} : { effects: input.effects }),
    completedAt: input.now,
  });
  if (input.lock)
    fixture.runtime.storage.acceptPosition(
      input.sessionId,
      admitted.positionId,
      input.now,
    );
  return admitted;
}

export async function listen(runtime: Runtime): Promise<string> {
  return runtime.app.listen({ host: '127.0.0.1', port: 0 });
}

export async function createSession(
  address: string,
  botSlug = 'echo',
): Promise<string> {
  const response = await fetch(`${address}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ botSlug }),
  });
  if (!response.ok) throw new Error(await response.text());
  return ((await response.json()) as { id: string }).id;
}

export async function streamAttempt(
  address: string,
  sessionId: string,
  command: unknown,
): Promise<Response> {
  return fetch(`${address}/api/sessions/${sessionId}/attempts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command),
  });
}

export async function readEvents(
  response: Response,
): Promise<import('@simplebot/shared').AttemptEvent[]> {
  const source = await response.text();
  return source
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map(
      (line) =>
        JSON.parse(
          line.slice('data: '.length),
        ) as import('@simplebot/shared').AttemptEvent,
    );
}

async function writeAuthoredRoot(
  root: string,
  provider: string,
  model: string,
  loginEnabled: boolean,
): Promise<void> {
  await Promise.all([
    mkdir(join(root, 'bots', 'help'), { recursive: true }),
    mkdir(join(root, 'bots', 'echo'), { recursive: true }),
    mkdir(join(root, 'presets'), { recursive: true }),
  ]);
  const card = (name: string) => ({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name,
      description: `${name} description`,
      personality: 'Direct and concise.',
      scenario: 'A kernel test.',
      mes_example: '<START>\n{{user}}: ping\n{{char}}: pong',
      system_prompt: '',
      post_history_instructions: '',
      extensions: {
        simplebot: {
          defaultPreset: 'default',
          capabilities:
            name === 'Echo'
              ? SYSTEM_TOOL_DEFINITIONS.filter(
                  ({ selectable }) => selectable,
                ).map(({ name }) => ({ kind: 'tool', name }))
              : [],
        },
      },
    },
  });
  await Promise.all([
    writeFile(
      join(root, 'config.json'),
      JSON.stringify({
        application: {
          timezone: 'UTC',
          maxMessageChars: 8_000,
          maxModelCallsPerTurn: 3,
          modelCallTimeoutMs: 10_000,
          maxToolCallsPerTurn: 3,
          maxToolResultChars: 1_000,
          maxToolResultCharsTotal: 2_000,
          loginEnabled,
        },
        providers: { [provider]: {} },
        memoryServers: {},
      }),
    ),
    writeFile(
      join(root, 'bots', 'help', 'help.json'),
      JSON.stringify(card('Help')),
    ),
    writeFile(
      join(root, 'bots', 'echo', 'echo.json'),
      JSON.stringify(card('Echo')),
    ),
    writeFile(
      join(root, 'presets', 'default.json'),
      JSON.stringify({
        persona: { name: 'User', description: 'The test operator.' },
        mainModel: { provider, model },
        mainEffort: 'off',
        prompts: {
          system: 'Today is {{date}}.',
          instructions: 'Stay consistent.',
          postHistory: '',
        },
      }),
    ),
  ]);
}

/** Change only settings in a card fixture, preserving its writing. */
export async function writeBotSettings(
  root: string,
  settings: Record<string, unknown>,
): Promise<void> {
  const path = join(root, 'bots', 'echo', 'echo.json');
  const document = JSON.parse(await readFile(path, 'utf8')) as {
    data: { extensions?: Record<string, unknown> };
  };
  document.data.extensions = {
    ...document.data.extensions,
    simplebot: { defaultPreset: 'default', ...settings },
  };
  await writeFile(path, JSON.stringify(document));
}
