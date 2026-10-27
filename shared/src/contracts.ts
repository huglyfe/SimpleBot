import { z } from 'zod';
import { todoSchema } from './todos.js';
import { slug } from './slug.js';

export const REASONING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

const id = z.uuid();
const timestamp = z.iso.datetime();

export const unknownRecordSchema = z.record(z.string(), z.unknown());

export const authStatusResponseSchema = z.strictObject({
  loginEnabled: z.boolean(),
  authenticated: z.boolean(),
});

export const authExchangeRequestSchema = z.strictObject({
  credential: z.string().min(1).max(128),
});

export const authExchangeResponseSchema = z.strictObject({
  authenticated: z.literal(true),
  expiresAt: timestamp.nullable(),
});

export const errorResponseSchema = z.strictObject({
  error: z.string().min(1),
});

export const createSessionRequestSchema = z.strictObject({
  botSlug: slug,
  presetSlug: slug.optional(),
});

export const bootstrapSchema = z.strictObject({
  /** The running distribution's version, so no client spells one of its own. */
  version: z.string().min(1),
  ttsConfigured: z.boolean(),
  bots: z.array(
    z.strictObject({
      slug,
      name: z.string().min(1),
      avatarUrl: z.string().min(1).nullable(),
    }),
  ),
  sessions: z.array(
    z.strictObject({
      id,
      botSlug: slug,
      presetSlug: slug,
      title: z.string().min(1),
      updatedAt: timestamp,
    }),
  ),
});

const capabilityName = z.string().min(1).max(512);

export const botCapabilitySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('tool'), name: capabilityName }),
  z.strictObject({ kind: z.literal('skill'), name: capabilityName }),
  z.strictObject({ kind: z.literal('memory'), dependency: capabilityName }),
  z.strictObject({ kind: z.literal('terminal'), dependency: capabilityName }),
]);

export function capabilityIdentity(capability: BotCapability): string {
  const name =
    capability.kind === 'tool' || capability.kind === 'skill'
      ? capability.name
      : capability.dependency;
  return `${capability.kind}:${name}`;
}

export const capabilityCatalogResponseSchema = z.strictObject({
  dependencies: z.array(
    z.discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('mcp'),
        name: capabilityName,
        available: z.boolean(),
        error: z.string().nullable(),
      }),
      z.strictObject({
        kind: z.literal('memory'),
        name: capabilityName,
        available: z.boolean(),
        error: z.string().nullable(),
      }),
      z.strictObject({
        kind: z.literal('docker'),
        name: capabilityName,
        available: z.boolean(),
        error: z.string().nullable(),
      }),
    ]),
  ),
  capabilities: z.array(
    z.discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('tool'),
        name: capabilityName,
        description: z.string(),
        available: z.boolean(),
      }),
      z.strictObject({
        kind: z.literal('skill'),
        name: capabilityName,
        description: z.string(),
        available: z.boolean(),
      }),
      z.strictObject({
        kind: z.literal('memory'),
        dependency: capabilityName,
        retains: z.boolean(),
        available: z.boolean(),
      }),
      z.strictObject({
        kind: z.literal('terminal'),
        dependency: capabilityName,
        available: z.boolean(),
      }),
    ]),
  ),
});

/**
 * Presets available on disk. Files own preset content; this only enumerates
 * what can be selected, so the picker offers real choices instead of a slug
 * the operator has to remember.
 */
export const presetListResponseSchema = z.strictObject({
  presets: z.array(
    z.strictObject({
      slug: z.string().min(1),
      name: z.string().optional(),
      model: z.string(),
    }),
  ),
});

/**
 * The chat providers pi-ai knows about.
 * The provider list is the library's, not ours — the client renders it and
 * never invents entries.
 */
export const providerListResponseSchema = z.strictObject({
  providers: z.array(
    z.strictObject({
      id: z.string().min(1),
      name: z.string().min(1),
    }),
  ),
});

/**
 * One provider's models as of the last refresh. `error` reports a provider
 * that could not be reached; the last-known list is still returned, because a
 * provider outage must not empty the operator's model picker.
 */
export const providerModelsResponseSchema = z.strictObject({
  models: z.array(
    z.strictObject({
      id: z.string().min(1),
      name: z.string().min(1),
      reasoning: z.boolean(),
      reasoningLevels: z.array(z.enum(REASONING_LEVELS)),
      images: z.boolean(),
      contextWindow: z.number().int().nonnegative(),
    }),
  ),
  error: z.string().nullable(),
});

export const sessionPresetRequestSchema = z.strictObject({ presetSlug: slug });

export const sessionTitleRequestSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
});

/** Cross-session search: which conversations match, and where. */
export const sessionSearchResponseSchema = z.strictObject({
  results: z.array(
    z.strictObject({
      sessionId: id,
      snippet: z.string(),
    }),
  ),
});

export const authoredDocumentSchema = z.strictObject({
  value: z.record(z.string(), z.unknown()),
  revision: z.string().min(1),
});

export const authoredDocumentWriteSchema = z.strictObject({
  value: z.record(z.string(), z.unknown()),
  expectedRevision: z.string().min(1),
});

export const createBotRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(255),
});

export const botImportRequestSchema = z.strictObject({
  name: createBotRequestSchema.shape.name.optional(),
  filename: z.string().trim().min(1).max(255),
  data: z.string().min(1),
});

export const botArtworkWriteSchema = botImportRequestSchema.pick({
  data: true,
});
export const botArtworkResponseSchema = z.strictObject({
  avatarUrl: z.string().min(1),
});

export const botImportResponseSchema = z.strictObject({
  slug,
  name: z.string().min(1),
  avatarUrl: z.string().min(1).nullable(),
});

export const createSessionResponseSchema = z.strictObject({
  id,
  botSlug: z.string().min(1),
  presetSlug: z.string().min(1),
  createdAt: timestamp,
});

export const revisionResponseSchema = authoredDocumentSchema.pick({
  revision: true,
});

/**
 * One session-local variable. The limits are named because the operator's
 * direct control enforces them in the client before it writes — a client that
 * restated them could drift from the route that actually rejects.
 */
export const VARIABLE_NAME_MAX = 100;
export const VARIABLE_VALUE_MAX = 8_000;
export const variableWriteSchema = z.strictObject({
  previousName: z.string().trim().min(1).max(VARIABLE_NAME_MAX).optional(),
  name: z.string().trim().min(1).max(VARIABLE_NAME_MAX),
  value: z.string().max(VARIABLE_VALUE_MAX),
});
/**
 * Swipe navigation is directional because the client no longer holds sibling
 * IDs — the server orders variants, so it can step through them.
 */
export const selectVariantRequestSchema = z.strictObject({
  direction: z.enum(['previous', 'next']),
});
export const editLeafRequestSchema = z.strictObject({
  source: z.string().trim(),
});

export const editSourceRequestSchema = z.strictObject({
  source: z.string().trim().min(1),
});

export const attemptCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('reply'),
    text: z.string().trim().min(1),
    attachmentIds: z.array(id).max(8).optional(),
  }),
  z.strictObject({
    kind: z.literal('swipe'),
    positionId: id,
  }),
]);

export const scheduleWriteSchema = z.strictObject({
  id: id.optional(),
  name: z.string().trim().min(1).max(120),
  expression: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(20_000),
  enabled: z.boolean().default(true),
});

export const uploadAttachmentRequestSchema = z.strictObject({
  filename: z.string().trim().min(1).max(255),
  data: z.string().min(1),
});

export const attachmentSchema = z.strictObject({
  id,
  filename: z.string().min(1),
  mimeType: z.enum(['image/png', 'image/jpeg']),
  byteSize: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const speechResponseSchema = z.strictObject({
  key: z.string().min(1),
  cached: z.boolean(),
  url: z.string().min(1),
});

export const usageSchema = z.strictObject({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheRead: z.number().nonnegative(),
  cacheWrite: z.number().nonnegative(),
  cacheWrite1h: z.number().nonnegative().optional(),
  reasoning: z.number().nonnegative().optional(),
  totalTokens: z.number().nonnegative(),
  cost: z.strictObject({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
    cacheRead: z.number().nonnegative(),
    cacheWrite: z.number().nonnegative(),
    total: z.number().nonnegative(),
  }),
});

const toolActivitySchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
  result: z.string().nullable(),
  isError: z.boolean(),
  startedAt: timestamp,
  completedAt: timestamp.nullable(),
});

export const traceSchema = z.array(
  z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('reasoning'), text: z.string() }),
    z.strictObject({ type: z.literal('tool'), ...toolActivitySchema.shape }),
  ]),
);

export const storedVariantSchema = z.strictObject({
  id,
  ordinal: z.number().int().positive(),
  source: z.string(),
  trace: traceSchema,
  provider: z.string().min(1),
  model: z.string().min(1),
  usage: z.array(usageSchema.nullable()),
  effects: z.array(
    z.strictObject({
      id,
      ordinal: z.number().int().nonnegative(),
      type: z.string().min(1),
      arguments: z.record(z.string(), z.unknown()),
      state: z.enum([
        'candidate',
        'accepted',
        'applied',
        'failed',
        'unresolved',
      ]),
      result: z.string().nullable(),
    }),
  ),
  createdAt: timestamp,
});

const messagePositionSchema = z.discriminatedUnion('role', [
  z.strictObject({
    id,
    ordinal: z.number().int().nonnegative(),
    role: z.literal('user'),
    source: z.string(),
    attachments: z.array(attachmentSchema),
    createdAt: timestamp,
  }),
  z.strictObject({
    id,
    ordinal: z.number().int().nonnegative(),
    role: z.literal('assistant'),
    locked: z.boolean(),
    /**
     * The selected variant alone, and always present: a position is written
     * with its first variant and never loses its last one, so there is no
     * state in which an assistant position has nothing to show. Siblings never
     * leave the server — only the selected variant enters context, and the
     * swipe control needs a counter rather than the bodies it counts.
     */
    variant: storedVariantSchema,
    /** Zero-based position of `variant` among its siblings, for `2/5`. */
    variantIndex: z.number().int().nonnegative(),
    variantCount: z.number().int().nonnegative(),
    createdAt: timestamp,
  }),
]);

export const committedLeafSchema = z.strictObject({
  id,
  triggerPositionId: id,
  startOrdinal: z.number().int().nonnegative(),
  endOrdinal: z.number().int().nonnegative(),
  createdAt: timestamp,
  state: z.literal('committed'),
  summary: z.string(),
  summaryOutcome: z.enum(['model', 'fallback-unavailable', 'fallback-clipped']),
});

export const sessionContextSchema = z.strictObject({
  timezone: z.string().min(1),
  leaves: z.array(
    committedLeafSchema.extend({
      startExchange: z.number().int().positive(),
      endExchange: z.number().int().positive(),
    }),
  ),
  lastRequestUsage: usageSchema.nullable(),
  /** Provider-reported cost of every call in the latest selected swipe, in USD. */
  lastSwipeCost: z.number().nonnegative().nullable(),
  exactFromExchange: z.number().int().positive(),
  currentExchange: z.number().int().nonnegative(),
  canCompact: z.boolean(),
  variables: z.array(
    z.strictObject({
      name: z.string().min(1),
      value: z.string(),
    }),
  ),
  todos: z.array(todoSchema),
  schedules: z.array(
    z.strictObject({
      id,
      name: z.string(),
      expression: z.string(),
      prompt: z.string(),
      enabled: z.boolean(),
      nextRunAt: timestamp.nullable(),
      /** Why this schedule has no next run, when the expression is at fault. */
      nextRunError: z.string().nullable(),
    }),
  ),
});

/**
 * One contiguous slice of transcript, newest page first. Context owns leaves.
 */
export const transcriptPageSchema = z.strictObject({
  positions: z.array(messagePositionSchema),
  /** Older positions exist before `positions[0]`. */
  hasMore: z.boolean(),
});

/**
 * Session-wide state, which is bounded by construction and rides every
 * response. The transcript does not: it is paged, because it never stops
 * growing.
 */
const sessionStateShape = {
  id,
  botSlug: z.string().min(1),
  presetSlug: z.string().min(1),
  createdAt: timestamp,
  updatedAt: timestamp,
};

export const sessionProjectionSchema = z.strictObject({
  ...sessionStateShape,
  page: transcriptPageSchema,
  activeAttemptId: id.nullable(),
});

/**
 * A mutation's answer: current session state plus only the rows the mutation
 * changed. The client merges these into whatever pages it holds, so editing a
 * message never re-ships the transcript around it.
 */
export const sessionChangeSchema = z.strictObject({
  ...sessionStateShape,
  positions: z.array(messagePositionSchema),
});

const attemptEventBase = {
  attemptId: id,
  at: timestamp,
};

const attemptEventPayloadSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('queued'),
  }),
  z.strictObject({
    type: z.literal('admitted'),
    positionId: id,
    variantId: id,
  }),
  z.strictObject({
    type: z.literal('text_delta'),
    delta: z.string(),
  }),
  z.strictObject({
    type: z.literal('thinking_delta'),
    delta: z.string(),
  }),
  z.strictObject({
    type: z.literal('tool_call'),
    id: z.string().min(1),
    name: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({
    type: z.literal('tool_result'),
    id: z.string().min(1),
    name: z.string().min(1),
    result: z.string(),
    isError: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('completed'),
    positionId: id,
    variantId: id,
  }),
]);

const [firstEvent, ...otherEvents] = attemptEventPayloadSchema.options;
export const attemptEventSchema = z.discriminatedUnion('type', [
  firstEvent.extend(attemptEventBase),
  ...otherEvents.map((event) => event.extend(attemptEventBase)),
]);
export type AttemptEventPayload = z.infer<typeof attemptEventPayloadSchema>;

export type AttemptCommand = z.infer<typeof attemptCommandSchema>;
export type Bootstrap = z.infer<typeof bootstrapSchema>;
export type BotImportResponse = z.infer<typeof botImportResponseSchema>;
export type ScheduleWrite = z.infer<typeof scheduleWriteSchema>;
export type AttemptEvent = z.infer<typeof attemptEventSchema>;
export type MessagePosition = z.infer<typeof messagePositionSchema>;
export type CommittedLeaf = z.infer<typeof committedLeafSchema>;
export type Usage = z.infer<typeof usageSchema>;
export type SessionSearchResponse = z.infer<typeof sessionSearchResponseSchema>;
export type SessionContext = z.infer<typeof sessionContextSchema>;
export type TranscriptPage = z.infer<typeof transcriptPageSchema>;
export type SessionState = Omit<SessionProjection, 'page' | 'activeAttemptId'>;
export type SessionProjection = z.infer<typeof sessionProjectionSchema>;
export type SessionChange = z.infer<typeof sessionChangeSchema>;
export type StoredVariant = z.infer<typeof storedVariantSchema>;
export type Trace = z.infer<typeof traceSchema>;
export type ToolActivity = z.infer<typeof toolActivitySchema>;
export type BotCapability = z.infer<typeof botCapabilitySchema>;
export type CapabilityCatalog = z.infer<typeof capabilityCatalogResponseSchema>;
export type PresetList = z.infer<typeof presetListResponseSchema>;
export type ProviderList = z.infer<typeof providerListResponseSchema>;
export type ProviderModels = z.infer<typeof providerModelsResponseSchema>;

/** Provider-reported prompt tokens, including mutually exclusive cache categories. */
export function promptTokenCount(usage: Usage): number {
  return usage.input + usage.cacheRead + usage.cacheWrite;
}

/** Standalone Skill authoring; additional YAML fields stay server-owned. */
export const skillValueSchema = z.strictObject({
  name: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u),
  description: z.string().trim().min(1).max(1024),
  instructions: z.string(),
});
export const skillDocumentSchema = z.strictObject({
  value: skillValueSchema,
  revision: z.string().min(1),
});
export const skillListSchema = z.array(skillDocumentSchema);
export const revisionRequestSchema = z.strictObject({
  expectedRevision: z.string().min(1),
});
