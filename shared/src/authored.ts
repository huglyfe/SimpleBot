/** Authored JSON shapes shared by file validation and settings clients. */
import { z } from 'zod';
import { authoredDocumentSchema, REASONING_LEVELS } from './contracts.js';
import { slug } from './slug.js';
export { slug } from './slug.js';

export const SPEECH_DEFAULTS = {
  maxAudioBytes: 16 * 1024 * 1024,
  timeoutMs: 60_000,
};

export const credential = z
  .string()
  .regex(
    /^(?:\$\{[A-Za-z_][A-Za-z0-9_]*\}|secret:(?!__proto__$)[A-Za-z_][A-Za-z0-9_]{0,127})$/u,
    'must be an exact ${NAME} or secret:NAME reference',
  );

export const secretNameSchema = z
  .string()
  .regex(/^(?!__proto__$)[A-Za-z_][A-Za-z0-9_]{0,127}$/u);
export const secretListSchema = z.strictObject({
  names: z.array(secretNameSchema),
  revision: z.string(),
});
export const secretWriteSchema = z.strictObject({
  value: z.string().min(1).max(16_384),
  expectedRevision: z.string(),
});
export const secretDeleteSchema = z.strictObject({
  expectedRevision: z.string(),
});
const httpUrl = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
});

const providerConfigSchema = z.strictObject({
  apiKey: credential.optional(),
  baseUrl: z.url().optional(),
});

const stdioMcpSchema = z.strictObject({
  type: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), credential).default({}),
  cwd: z.string().min(1).optional(),
});

const httpMcpSchema = z.strictObject({
  type: z.literal('streamable-http'),
  url: httpUrl,
  headers: z.record(z.string(), credential).default({}),
});

export const mcpDefinitionSchema = z.discriminatedUnion('type', [
  stdioMcpSchema,
  httpMcpSchema,
]);

function serverDefinitionsSchema(label: 'MCP' | 'Memory') {
  return z
    .record(
      slug.refine((name) => !name.includes('__') && !name.endsWith('_'), {
        message: 'MCP server names cannot contain __ or end with _',
      }),
      mcpDefinitionSchema,
    )
    .refine((servers) => Object.keys(servers).length <= 64, {
      message: `must contain at most 64 ${label} servers`,
    })
    .default({});
}

const mcpServersSchema = serverDefinitionsSchema('MCP');
const memoryServersSchema = serverDefinitionsSchema('Memory');

function serverNamesAreDistinct(value: {
  mcpServers: Record<string, unknown>;
  memoryServers: Record<string, unknown>;
}): boolean {
  return !Object.keys(value.memoryServers).some((name) =>
    Object.hasOwn(value.mcpServers, name),
  );
}

const dockerContainersSchema = z
  .record(slug, z.string().min(1).max(255))
  .refine((containers) => Object.keys(containers).length <= 64, {
    message: 'must contain at most 64 Docker containers',
  })
  .default({});

export const appConfigSchema = z
  .strictObject({
    application: z.strictObject({
      timezone: z.string().min(1).default('UTC'),
      maxMessageChars: z.number().int().positive().default(8_000),
      maxModelCallsPerTurn: z.number().int().positive().default(5),
      modelCallTimeoutMs: z.number().int().positive().default(120_000),
      maxToolCallsPerTurn: z.number().int().nonnegative().default(30),
      maxToolResultChars: z.number().int().positive().default(12_000),
      maxToolResultCharsTotal: z.number().int().positive().default(24_000),
      maxImageDimension: z.number().int().positive().default(8_192),
      terminalTimeoutMs: z.number().int().positive().default(120_000),
      terminalMaxOutputChars: z.number().int().positive().default(24_000),
      loginEnabled: z.boolean().default(true),
      browserLoginExpiryDays: z.number().int().min(0).max(36500).default(30),
    }),
    providers: z.record(z.string().min(1), providerConfigSchema),
    mcpServers: mcpServersSchema,
    memoryServers: memoryServersSchema,
    dockerContainers: dockerContainersSchema,
    tts: z
      .strictObject({
        baseUrl: httpUrl,
        apiKey: credential,
        model: z.string().min(1),
        maxAudioBytes: z
          .number()
          .int()
          .positive()
          .default(SPEECH_DEFAULTS.maxAudioBytes),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .default(SPEECH_DEFAULTS.timeoutMs),
      })
      .nullable()
      .default(null),
  })
  .refine(serverNamesAreDistinct, {
    message: 'Memory server names must be distinct from MCP server names',
    path: ['memoryServers'],
  });

export const dependencyConfigSchema = z
  .strictObject({
    mcpServers: mcpServersSchema,
    memoryServers: memoryServersSchema,
    dockerContainers: dockerContainersSchema,
  })
  .refine(serverNamesAreDistinct, {
    message: 'Memory server names must be distinct from MCP server names',
    path: ['memoryServers'],
  });

const modelReferenceSchema = z.strictObject({
  provider: z.string().min(1),
  model: z.string().min(1),
});

const presetFields = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  persona: z.object({
    name: z.string().min(1),
    description: z.string(),
  }),
  mainModel: modelReferenceSchema,
  mainEffort: z.enum(REASONING_LEVELS).default('off'),
  summaryEffort: z.enum(REASONING_LEVELS).default('off'),
  tts: z
    .strictObject({
      voice: z.string().min(1),
      speed: z.number().min(0.25).max(4).default(1),
    })
    .default({ voice: 'alloy', speed: 1 }),
  prompts: z.object({
    system: z.string(),
    instructions: z.string(),
    postHistory: z.string().default(''),
    summarization: z
      .string()
      .default('Summarize the committed conversation for future continuity.'),
  }),
  context: z
    .object({
      thresholdTokens: z.number().int().positive().default(10_000),
      liveTailExchanges: z.number().int().positive().default(10),
      activeLeafCap: z.number().int().positive().default(5),
      summaryLengthChars: z.number().int().min(100).default(6_000),
    })
    .default({
      thresholdTokens: 10_000,
      liveTailExchanges: 10,
      activeLeafCap: 5,
      summaryLengthChars: 6_000,
    }),
});

export const presetSchema = z.discriminatedUnion('useMainModelForSummary', [
  presetFields.extend({
    useMainModelForSummary: z.literal(true).default(true),
    summaryModel: modelReferenceSchema.nullable().default(null),
  }),
  presetFields.extend({
    useMainModelForSummary: z.literal(false),
    summaryModel: modelReferenceSchema,
  }),
]);

export type AppConfig = z.infer<typeof appConfigSchema>;
export type DependencyConfigDraft = Pick<
  AppConfig,
  'mcpServers' | 'memoryServers' | 'dockerContainers'
>;
export type McpDefinition = z.infer<typeof mcpDefinitionSchema>;
export type Preset = z.infer<typeof presetSchema>;

export const APPLICATION_DEFAULTS = Object.freeze(
  appConfigSchema.shape.application.parse({}),
);

export const settingsSchema = z.strictObject({
  application: appConfigSchema.shape.application,
  providers: appConfigSchema.shape.providers,
  tts: appConfigSchema.shape.tts,
});
export type AppSettings = z.infer<typeof settingsSchema>;

export const settingsDocumentSchema = authoredDocumentSchema.extend({
  value: settingsSchema,
});
export const dependencyDocumentSchema = authoredDocumentSchema.extend({
  value: dependencyConfigSchema,
});
export const presetDocumentSchema = authoredDocumentSchema.extend({
  value: presetSchema,
});
