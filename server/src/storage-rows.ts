/**
 * SQLite row shapes and the pure functions that turn them into contract types.
 *
 * This is the one seam inside storage that owes nothing to the connection: a
 * row in, a contract value out. `Storage` stays one class over one connection
 * and imports these; nothing here reaches back.
 */
import type Database from 'better-sqlite3';
import { Cron } from 'croner';
import { z } from 'zod';
import {
  unknownRecordSchema,
  attachmentSchema,
  committedLeafSchema,
  storedVariantSchema,
  type CommittedLeaf,
  type MessagePosition,
  type ScheduleWrite,
  type StoredVariant,
  traceSchema,
} from '@simplebot/shared';

import { StorageConflictError } from './storage-errors.js';

/**
 * One session's display title: the operator's own title when set, otherwise
 * the opening of the first message in the conversation — an authored greeting
 * as readily as a first reply, so the label matches what the operator reads at
 * the top of the transcript. Only the selected variant can name a session. Written once here
 * because the session list and cross-session search must agree on it.
 * The argument is the SQL alias the surrounding query gives `sessions`.
 */
const SESSION_TITLE_CHARACTERS = 60;
export function sessionDisplayTitleSql(session: string): string {
  return `substr(COALESCE(
            ${session}.title,
            (SELECT CASE WHEN first.role = 'user' THEN first.source
                         ELSE selected.source END
             FROM message_positions first
             LEFT JOIN message_variants selected
               ON selected.id = first.selected_variant_id
             WHERE first.session_id = ${session}.id
               AND trim(CASE WHEN first.role = 'user' THEN first.source ELSE selected.source END) <> ''
             ORDER BY first.ordinal LIMIT 1),
            'New conversation'
          ), 1, ${String(SESSION_TITLE_CHARACTERS)})`;
}

/**
 * A leaf carries its frozen `source` — the exact transcript of everything it
 * covers — so reads that do not need to summarise deliberately leave it
 * behind. Carrying it would reintroduce the whole history one indirection
 * away. `createPendingLeaf()` returns it directly to the summarizer.
 */
export type StoredLeaf = Omit<
  CommittedLeaf,
  'state' | 'summary' | 'summaryOutcome'
> & {
  state: 'pending';
  summary: null;
  priorLeafId: string | null;
  source: string;
};

export type StoredAttachment = z.infer<typeof attachmentSchema>;

export type StoredSchedule = ScheduleWrite & {
  id: string;
  sessionId: string;
};

export interface SessionRow {
  id: string;
  bot_slug: string;
  preset_slug: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface PositionVariantRow {
  position_id: string;
  position_ordinal: number;
  role: 'assistant' | 'user';
  position_source: string | null;
  selected_variant_id: string | null;
  locked_at: string | null;
  position_created_at: string;
  variant_id: string | null;
  variant_ordinal: number | null;
  variant_source: string | null;
  provider: string | null;
  model: string | null;
  trace_json: string | null;
  usage_json: string | null;
  variant_created_at: string | null;
  variant_index: number;
  variant_count: number;
}

/** Canonical model input omits client-only inspection data. */
export type ContextPosition =
  | Extract<MessagePosition, { role: 'user' }>
  | (Omit<
      Extract<MessagePosition, { role: 'assistant' }>,
      'variant' | 'variantIndex' | 'variantCount'
    > & {
      variant: Omit<StoredVariant, 'trace' | 'effects'>;
    });

type ContextPositionRow = Omit<
  PositionVariantRow,
  'trace_json' | 'variant_index' | 'variant_count'
>;

export interface EffectRow {
  id: string;
  variant_id: string;
  ordinal: number;
  type: string;
  arguments_json: string;
  state: 'candidate' | 'accepted' | 'applied' | 'failed' | 'unresolved';
  result: string | null;
}

export interface SessionLeafRow {
  id: string;
  start_ordinal: number;
  end_ordinal: number;
  trigger_position_id: string;
  state: 'pending' | 'committed';
  summary: string | null;
  summary_outcome: 'model' | 'fallback-unavailable' | 'fallback-clipped' | null;
  created_at: string;
}

export interface AttachmentRow {
  id: string;
  position_id: string | null;
  storage_key: string;
  filename: string;
  mime_type: 'image/png' | 'image/jpeg';
  byte_size: number;
  width: number;
  height: number;
}

export interface ScheduleRow {
  id: string;
  session_id: string;
  name: string;
  expression: string;
  prompt: string;
  enabled: number;
}

/** One row per position: the read joins exactly one variant, never a fan-out. */
export function decodePositions(
  rows: readonly PositionVariantRow[],
  effects: readonly EffectRow[],
  attachments: readonly AttachmentRow[],
): MessagePosition[] {
  const effectsByVariant = Map.groupBy(effects, (effect) => effect.variant_id);
  return decodeContextPositions(rows, attachments).map((position, index) => {
    if (position.role === 'user') return position;
    const row = rows[index];
    if (row === undefined) throw new Error('Missing position row');
    return {
      ...position,
      variantIndex: row.variant_index,
      variantCount: row.variant_count,
      variant: {
        ...position.variant,
        trace: traceSchema.parse(
          JSON.parse(required(row.trace_json, 'variant trace')),
        ),
        effects: (effectsByVariant.get(position.variant.id) ?? []).map(
          (effect) => ({
            id: effect.id,
            ordinal: effect.ordinal,
            type: effect.type,
            arguments: unknownRecordSchema.parse(
              JSON.parse(effect.arguments_json),
            ),
            state: effect.state,
            result: effect.result,
          }),
        ),
      },
    };
  });
}

export function decodeContextPositions(
  rows: readonly ContextPositionRow[],
  attachments: readonly AttachmentRow[],
): ContextPosition[] {
  const attachmentsByPosition = Map.groupBy(
    attachments,
    (item) => item.position_id,
  );
  return rows.map((row) =>
    row.role === 'user'
      ? {
          id: row.position_id,
          ordinal: row.position_ordinal,
          role: 'user',
          source: required(row.position_source, 'user source'),
          attachments: (attachmentsByPosition.get(row.position_id) ?? []).map(
            decodeAttachment,
          ),
          createdAt: row.position_created_at,
        }
      : {
          id: row.position_id,
          ordinal: row.position_ordinal,
          role: 'assistant',
          locked: row.locked_at !== null,
          variant: {
            id: required(row.variant_id, 'selected variant'),
            ordinal: required(row.variant_ordinal, 'variant ordinal'),
            source: required(row.variant_source, 'variant source'),
            provider: required(row.provider, 'variant provider'),
            model: required(row.model, 'variant model'),
            usage: storedVariantSchema.shape.usage.parse(
              JSON.parse(required(row.usage_json, 'variant usage')),
            ),
            createdAt: required(row.variant_created_at, 'variant created at'),
          },
          createdAt: row.position_created_at,
        },
  );
}

/** Read helpers use the owning storage connection. */
export type Prepare = (sql: string) => Database.Statement;

/** `?, ?, ?` for an IN list. */
export function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}

export function required<T>(value: T | null, name: string): T {
  if (value === null) throw new Error(`Corrupt ${name}`);
  return value;
}

export function decodeLeaf(row: SessionLeafRow): CommittedLeaf {
  return committedLeafSchema.parse({
    id: row.id,
    startOrdinal: row.start_ordinal,
    endOrdinal: row.end_ordinal,
    triggerPositionId: row.trigger_position_id,
    state: row.state,
    summary: row.summary,
    summaryOutcome: row.summary_outcome,
    createdAt: row.created_at,
  });
}

function decodeAttachment(row: AttachmentRow): StoredAttachment {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    width: row.width,
    height: row.height,
  };
}

export function decodeSchedule(row: ScheduleRow): StoredSchedule {
  return {
    id: row.id,
    sessionId: row.session_id,
    name: row.name,
    expression: row.expression,
    prompt: row.prompt,
    enabled: row.enabled === 1,
  };
}

/**
 * The next occurrence strictly after now.
 *
 * Anchored to the present on purpose: a schedule is active or it is not, and
 * carries no scheduled state to catch up on. One that came due while the
 * engine was down advances to a single future occurrence in one step, so
 * waking fires it once instead of replaying everything that was missed.
 */
export function nextCronRun(
  expression: string,
  timezone: string,
  after = new Date(),
): string {
  try {
    const next = new Cron(expression, { timezone }).nextRun(after);
    if (next === null)
      throw new StorageConflictError('Schedule has no next run');
    return next.toISOString();
  } catch (error) {
    if (error instanceof StorageConflictError) throw error;
    throw new StorageConflictError(
      error instanceof Error ? error.message : 'Invalid schedule',
    );
  }
}

export function parseScheduleEffect(
  arguments_: Record<string, unknown>,
): ScheduleWrite {
  const { id, name, expression, prompt, enabled = true } = arguments_;
  if (
    (id !== undefined && typeof id !== 'string') ||
    typeof name !== 'string' ||
    typeof expression !== 'string' ||
    typeof prompt !== 'string' ||
    typeof enabled !== 'boolean'
  ) {
    throw new StorageConflictError('Invalid schedule effect');
  }
  return {
    ...(id === undefined ? {} : { id }),
    name,
    expression,
    prompt,
    enabled,
  };
}

export function inspectImage(data: Buffer): {
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
} {
  if (
    data.length >= 24 &&
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    const width = data.readUInt32BE(16);
    const height = data.readUInt32BE(20);
    if (width > 0 && height > 0)
      return { mimeType: 'image/png', width, height };
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = data[offset + 1] ?? 0;
      const length = data.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > data.length) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || marker === 0xc9) {
        const height = data.readUInt16BE(offset + 5);
        const width = data.readUInt16BE(offset + 7);
        if (width > 0 && height > 0)
          return { mimeType: 'image/jpeg', width, height };
      }
      offset += 2 + length;
    }
  }
  throw new StorageConflictError(
    'Only valid PNG and JPEG images are supported',
  );
}
