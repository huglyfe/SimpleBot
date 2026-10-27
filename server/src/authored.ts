import { createHash, randomUUID } from 'node:crypto';
import {
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import {
  appConfigSchema,
  cardSchema,
  dependencyConfigSchema,
  parseAuthored,
  parseAuthoredJson,
  presetSchema,
  AuthoredConflictError,
  AuthoredValidationError,
  MAX_BOT_PNG_BYTES,
  type AppConfig,
  type AuthoredAttempt,
  type DependencyConfigDraft,
  slug,
} from './authored-schemas.js';
import {
  botSettings,
  botGreetings,
  cardSourceSchema,
  type BotDocument,
  type BotSource,
} from '@simplebot/shared';
import { parsePng, parseEmbeddedCard } from './card-png.js';

// The schemas define what these files may contain; callers reach both through
// this module, which is the only thing that reads and writes them.
export {
  AuthoredConflictError,
  AuthoredValidationError,
  MAX_BOT_PNG_BYTES,
} from './authored-schemas.js';
export { mcpDefinitionSchema } from './authored-schemas.js';
export type {
  AppConfig,
  AuthoredAttempt,
  Card,
  BotCapability,
  BotSettings,
  DependencyConfigDraft,
  McpDefinition,
  Preset,
} from './authored-schemas.js';

export class AuthoredFiles {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  async validateRequired(): Promise<AppConfig> {
    return this.#readRequired('config.json', appConfigSchema);
  }

  async resolveSessionPreset(
    botSlug: string,
    requestedPreset: string | undefined,
  ): Promise<string> {
    slug.parse(botSlug);
    const document = await this.readBot(botSlug);
    const selected = requestedPreset ?? botSettings(document).defaultPreset;
    if (selected === undefined)
      throw new AuthoredValidationError('Choose a default preset for this bot');
    const presetSlug = slug.parse(selected);
    await this.#readRequired(
      join('presets', `${presetSlug}.json`),
      presetSchema,
    );
    return presetSlug;
  }

  async readApplication(): Promise<AppConfig['application']> {
    return (await this.#readRequired('config.json', appConfigSchema))
      .application;
  }

  async listBots(): Promise<
    { slug: string; name: string; avatarUrl: string | null }[]
  > {
    const entries = await readdir(join(this.#root, 'bots'), {
      withFileTypes: true,
    });
    const bots = await Promise.all(
      entries
        .filter(
          (entry) => entry.isDirectory() && slug.safeParse(entry.name).success,
        )
        .map(async (entry) => {
          try {
            const [card, artwork] = await Promise.all([
              this.readBot(entry.name),
              this.avatar(entry.name),
            ]);
            return {
              slug: entry.name,
              name: card.data.name,
              avatarUrl: artwork?.url ?? null,
            };
          } catch {
            return null;
          }
        }),
    );
    return bots
      .filter((entry) => entry !== null)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /**
   * Every preset on disk that parses. A preset that fails its schema is
   * omitted rather than reported: the picker offers what can actually be
   * selected, and opening a broken preset would fail with its own message.
   */
  async listPresets(): Promise<
    { slug: string; name: string; model: string }[]
  > {
    const entries = await readdir(join(this.#root, 'presets'), {
      withFileTypes: true,
    });
    const presets = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map(async (entry) => {
          const presetSlug = entry.name.slice(0, -'.json'.length);
          if (!slug.safeParse(presetSlug).success) return null;
          try {
            const preset = await this.#readRequired(
              join('presets', entry.name),
              presetSchema,
            );
            return {
              slug: presetSlug,
              name: preset.name ?? presetSlug,
              model: preset.mainModel.model,
            };
          } catch {
            return null;
          }
        }),
    );
    return presets
      .filter((entry) => entry !== null)
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          left.slug.localeCompare(right.slug),
      );
  }

  /** File metadata versions every image projection without a second authority. */
  async avatar(botSlug: string): Promise<{ path: string; url: string } | null> {
    slug.parse(botSlug);
    const path = join(this.#root, 'bots', botSlug, 'icon.png');
    try {
      const info = await stat(path, { bigint: true });
      return info.isFile()
        ? {
            path,
            url: `/api/bots/${encodeURIComponent(botSlug)}/avatar?v=${String(info.mtimeNs)}-${String(info.ino)}`,
          }
        : null;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async replaceBotArtwork(botSlug: string, data: Buffer): Promise<void> {
    await this.#validateArtwork(data);
    // Require an existing bot; artwork never installs or edits a character card.
    this.#botPath(botSlug);
    publishFile(join(this.#root, 'bots', botSlug, 'icon.png'), data);
  }

  async #validateArtwork(data: Buffer) {
    if (data.length === 0 || data.length > MAX_BOT_PNG_BYTES)
      throw new AuthoredValidationError('Bot PNG is empty or exceeds 10 MB');
    const png = parsePng(data);
    const maxDimension = (await this.readApplication()).maxImageDimension;
    if (png.width > maxDimension || png.height > maxDimension)
      throw new AuthoredValidationError(
        `Bot PNG dimensions exceed ${String(maxDimension)} pixels`,
      );
    return png;
  }

  async createBot(name: string) {
    return this.#installBot(
      cardSchema.parse({
        spec: 'chara_card_v3',
        spec_version: '3.0',
        data: {
          name,
          tags: [],
          creator: '',
          creator_notes: '',
          character_version: '',
          group_only_greetings: [],
        },
      }),
    );
  }

  async importBot(input: { data: Buffer; filename: string; name?: string }) {
    if (input.data.length === 0 || input.data.length > MAX_BOT_PNG_BYTES)
      throw new AuthoredValidationError('Bot import is empty or exceeds 10 MB');
    if (input.filename.toLowerCase().endsWith('.json')) {
      const raw = parseAuthoredJson(
        input.filename,
        input.data.toString('utf8'),
      );
      return this.#installBot(raw, input.filename, undefined, input.name);
    }
    const png = await this.#validateArtwork(input.data);
    const embedded = png.text.get('ccv3') ?? png.text.get('chara');
    if (embedded === undefined)
      throw new AuthoredValidationError(
        'Character PNG has no ccv3 or chara tEXt payload',
      );
    const raw = parseEmbeddedCard(input.filename, embedded);
    const expectedSpec = png.text.has('ccv3')
      ? 'chara_card_v3'
      : 'chara_card_v2';
    if (raw.spec !== expectedSpec)
      throw new AuthoredValidationError(
        `${input.filename} payload must declare spec ${expectedSpec}`,
      );
    return this.#installBot(raw, input.filename, input.data, input.name);
  }

  async #installBot(
    raw: unknown,
    sourceName = 'Bot',
    artwork?: Buffer,
    nameOverride?: string,
  ) {
    let document = parseAuthored(sourceName, cardSchema, raw);
    if (nameOverride !== undefined) {
      const source = raw as BotSource;
      raw = { ...source, data: { ...source.data, name: nameOverride } };
      document = parseAuthored(sourceName, cardSchema, raw);
    }
    if (botSettings(document).defaultPreset === undefined) {
      const [first] = await this.listPresets();
      if (first === undefined)
        throw new AuthoredValidationError(
          'Create a preset before adding a bot',
        );
      // Add only our selection; preserve the card's raw fields and extensions.
      const source = raw as BotSource;
      raw = {
        ...source,
        data: {
          ...source.data,
          extensions: {
            ...source.data.extensions,
            simplebot: {
              ...source.data.extensions?.simplebot,
              defaultPreset: first.slug,
            },
          },
        },
      };
      document = parseAuthored(sourceName, cardSchema, raw);
    }
    await this.#validateBotPreset(document);
    const name = document.data.name;
    const botSlug = deriveBotSlug(name);
    const bots = join(this.#root, 'bots');
    const target = join(bots, botSlug);
    if (await exists(target))
      throw new AuthoredConflictError(`Bot ${botSlug} already exists`);
    const temporary = join(bots, `.${botSlug}.${randomUUID()}.tmp`);
    await mkdir(temporary);
    let installed = false;
    try {
      await writeFile(
        join(temporary, `${botSlug}.json`),
        `${JSON.stringify(raw, null, 2)}\n`,
        { flag: 'wx' },
      );
      if (artwork !== undefined)
        await writeFile(join(temporary, 'icon.png'), artwork, { flag: 'wx' });
      if (await exists(target))
        throw new AuthoredConflictError(`Bot ${botSlug} already exists`);
      await rename(temporary, target);
      installed = true;
    } catch (error) {
      if (isCollision(error))
        throw new AuthoredConflictError(`Bot ${botSlug} already exists`);
      throw error;
    } finally {
      if (!installed) await rm(temporary, { recursive: true, force: true });
    }
    return {
      slug: botSlug,
      name,
      avatarUrl: (await this.avatar(botSlug))?.url ?? null,
    };
  }

  async readGreetings(botSlug: string): Promise<string[]> {
    return botGreetings(await this.readBot(botSlug)).map((greeting) =>
      greeting.trim() === '' ? '' : greeting,
    );
  }

  #botPath(botSlug: string): string {
    slug.parse(botSlug);
    const directory = join('bots', botSlug);
    let entries;
    try {
      entries = readdirSync(join(this.#root, directory), {
        withFileTypes: true,
      });
    } catch (error) {
      if (isMissing(error))
        throw new AuthoredValidationError(
          `${directory} is required but missing`,
        );
      throw error;
    }
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name);
    if (files.length !== 1 || files[0] === undefined)
      throw new AuthoredValidationError(
        `${directory} needs exactly one named character card JSON`,
      );
    return join(directory, files[0]);
  }

  async readBot(botSlug: string): Promise<BotDocument> {
    const path = this.#botPath(botSlug);
    return this.#readRequired(path, cardSchema);
  }

  async #validateBotPreset(document: BotDocument): Promise<void> {
    const preset = botSettings(document).defaultPreset;
    if (preset === undefined)
      throw new AuthoredValidationError('Choose a default preset for this bot');
    await this.#readRequired(join('presets', `${preset}.json`), presetSchema);
  }

  async readConfig(): Promise<{ value: AppConfig; revision: string }> {
    const source = await readFile(join(this.#root, 'config.json'), 'utf8');
    return {
      value: parseAuthored(
        'config.json',
        appConfigSchema,
        parseAuthoredJson('config.json', source),
      ),
      revision: revisionOf(source),
    };
  }

  async writeConfig(value: unknown, expectedRevision: string): Promise<string> {
    const path = join(this.#root, 'config.json');
    const current = readFileSync(path, 'utf8');
    if (revisionOf(current) !== expectedRevision)
      throw new AuthoredConflictError('Configuration changed on disk');
    const prior = parseAuthored(
      'config.json',
      appConfigSchema,
      parseAuthoredJson('config.json', current),
    );
    const candidate = parseAuthored('config.json', appConfigSchema, value);
    for (const provider of Object.keys(prior.providers)) {
      if (!(provider in candidate.providers))
        this.#assertProviderUnused(provider);
    }
    return publishDocument(path, candidate);
  }

  async readDependencyConfig(): Promise<{
    value: DependencyConfigDraft;
    revision: string;
  }> {
    const { value, revision } = await this.readConfig();
    return {
      value: {
        mcpServers: value.mcpServers,
        memoryServers: value.memoryServers,
        dockerContainers: value.dockerContainers,
      },
      revision,
    };
  }

  async writeDependencyConfig(
    value: unknown,
    expectedRevision: string,
  ): Promise<string> {
    const current = await this.readConfig();
    if (current.revision !== expectedRevision)
      throw new AuthoredConflictError('Configuration changed on disk');
    const dependencyConfig = parseAuthored(
      'config.json external dependencies',
      dependencyConfigSchema,
      value,
    );
    return this.writeConfig(
      { ...current.value, ...dependencyConfig },
      expectedRevision,
    );
  }

  #assertProviderUnused(provider: string): void {
    for (const name of readdirSync(join(this.#root, 'presets'))) {
      if (!name.endsWith('.json')) continue;
      let raw: unknown;
      try {
        raw = JSON.parse(
          readFileSync(join(this.#root, 'presets', name), 'utf8'),
        ) as unknown;
      } catch {
        continue;
      }
      const preset = presetSchema.safeParse(raw);
      if (!preset.success) continue;
      if (
        preset.data.mainModel.provider === provider ||
        preset.data.summaryModel?.provider === provider
      ) {
        throw new AuthoredConflictError(
          `Provider ${provider} is used by preset ${name.slice(0, -5)}`,
        );
      }
    }
  }

  async readBotDocument(botSlug: string) {
    const path = this.#botPath(botSlug);
    return this.#readDocument(path, cardSourceSchema);
  }

  async writeBotDocument(
    botSlug: string,
    value: unknown,
    expectedRevision: string,
  ) {
    const sourcePath = this.#botPath(botSlug);
    const document = parseAuthored(sourcePath, cardSchema, value);
    await this.#validateBotPreset(document);
    const path = this.#botPath(botSlug);
    if (path !== sourcePath)
      throw new AuthoredConflictError('Bot source changed on disk');
    return this.#writeDocument(path, value, expectedRevision, cardSourceSchema);
  }

  async readPresetDocument(presetSlug: string) {
    slug.parse(presetSlug);
    const path = join('presets', `${presetSlug}.json`);
    try {
      return await this.#readDocument(path, presetSchema);
    } catch (error) {
      if (isMissing(error))
        throw new AuthoredValidationError(`${path} is required but missing`);
      throw error;
    }
  }

  async writePresetDocument(
    presetSlug: string,
    value: unknown,
    expectedRevision: string,
  ) {
    slug.parse(presetSlug);
    return this.#writeDocument(
      join('presets', `${presetSlug}.json`),
      value,
      expectedRevision,
      presetSchema,
    );
  }

  /** Check every authored reference before removing the one preset source. */
  deletePreset(presetSlug: string, expectedRevision: string): void {
    slug.parse(presetSlug);
    for (const entry of readdirSync(join(this.#root, 'bots'), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory() || !slug.safeParse(entry.name).success) continue;
      const card = cardSchema.parse(
        JSON.parse(
          readFileSync(join(this.#root, this.#botPath(entry.name)), 'utf8'),
        ),
      );
      if (botSettings(card).defaultPreset === presetSlug)
        throw new AuthoredConflictError(
          `Preset is used by bot ${card.data.name}`,
        );
    }
    const relativePath = join('presets', `${presetSlug}.json`);
    const path = join(this.#root, relativePath);
    if (
      revisionOf(`${relativePath}\0${readFileSync(path, 'utf8')}`) !==
      expectedRevision
    )
      throw new AuthoredConflictError('Preset changed on disk');
    unlinkSync(path);
  }

  async readSessionSettings(presetSlug: string) {
    slug.parse(presetSlug);
    const [config, preset] = await Promise.all([
      this.#readRequired('config.json', appConfigSchema),
      this.#readRequired(join('presets', `${presetSlug}.json`), presetSchema),
    ]);
    return { config, preset };
  }

  async readAttempt(
    botSlug: string,
    presetSlug: string,
  ): Promise<AuthoredAttempt> {
    const [{ config, preset }, document] = await Promise.all([
      this.readSessionSettings(presetSlug),
      this.readBot(botSlug),
    ]);
    const writing = document.data;
    const resolve = (override: string, fallback: string) =>
      override.trim() === ''
        ? fallback
        : override.replace(/\{\{original\}\}/giu, () => fallback);
    return {
      config,
      writing: {
        ...writing,
        name:
          writing.nickname === undefined || writing.nickname.trim() === ''
            ? writing.name
            : writing.nickname,
        system_prompt: resolve(writing.system_prompt, preset.prompts.system),
        post_history_instructions: resolve(
          writing.post_history_instructions,
          preset.prompts.postHistory,
        ),
      },
      preset,
      bot: botSettings(document),
    };
  }

  get root(): string {
    return this.#root;
  }

  async #readDocument<T>(
    relativePath: string,
    schema: z.ZodType<T>,
  ): Promise<{ value: T; revision: string }> {
    const source = await readFile(join(this.#root, relativePath), 'utf8');
    const raw: unknown = parseAuthoredJson(relativePath, source);
    const parsed = parseAuthored(relativePath, schema, raw);
    return {
      value: parsed,
      revision: revisionOf(`${relativePath}\0${source}`),
    };
  }

  #writeDocument<T>(
    relativePath: string,
    value: unknown,
    expectedRevision: string,
    schema: z.ZodType<T>,
  ): string {
    const path = join(this.#root, relativePath);
    let current: string | null;
    try {
      current = readFileSync(path, 'utf8');
    } catch (error) {
      if (!isMissing(error)) throw error;
      current = null;
    }
    const revision =
      current === null ? 'missing' : revisionOf(`${relativePath}\0${current}`);
    if (revision !== expectedRevision)
      throw new AuthoredConflictError('Authored source changed on disk');
    const parsed = parseAuthored(relativePath, schema, value);
    return publishDocument(path, parsed, `${relativePath}\0`);
  }

  async #readRequired<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const value = await this.#readOptional(path, schema);
    if (value === null)
      throw new AuthoredValidationError(`${path} is required but missing`);
    return value;
  }

  async #readOptional<T>(
    path: string,
    schema: z.ZodType<T>,
  ): Promise<T | null> {
    let source: string;
    try {
      source = await readFile(join(this.#root, path), 'utf8');
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    return parseAuthored(path, schema, parseAuthoredJson(path, source));
  }
}

function revisionOf(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

/** The synchronous publication boundary shared by revision-checked writes. */
function publishDocument(
  path: string,
  value: unknown,
  revisionKey = '',
): string {
  const source = `${JSON.stringify(value, null, 2)}\n`;
  publishFile(path, source);
  return revisionOf(revisionKey + source);
}

/** Publish one complete file, leaving its prior contents intact on failure. */
function publishFile(path: string, source: string | Buffer): void {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, source, { flag: 'wx' });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function deriveBotSlug(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .replace(/\p{Mark}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80)
    .replace(/-+$/gu, '');
  return normalized.length === 0 ? 'bot' : normalized;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function isCollision(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'EEXIST' ||
      error.code === 'ENOTEMPTY' ||
      error.code === 'EISDIR')
  );
}
