import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type Database from 'better-sqlite3';
import { openDatabase } from './database.js';
import { acquireRuntimeOwnership } from './runtime-ownership.js';
import {
  MAX_TODOS,
  todoSchema,
  todoUpdateSchema,
  type Todo,
  type TodoUpdate,
  INTERRUPTED_ERROR,
  appendSystemError,
  unknownRecordSchema,
  usageSchema,
  type CommittedLeaf,
  type MessagePosition,
  type ScheduleWrite,
  type SessionChange,
  type SessionContext,
  type SessionProjection,
  type SessionState,
  type TranscriptPage,
  type Trace,
  type Usage,
} from '@simplebot/shared';

import {
  StorageConflictError,
  StorageNotFoundError,
} from './storage-errors.js';
import { syncAssistantSearch } from './storage-search.js';
import {
  decodeLeaf,
  decodeContextPositions,
  type ContextPosition,
  decodePositions,
  decodeSchedule,
  inspectImage,
  nextCronRun,
  parseScheduleEffect,
  placeholders,
  required,
  sessionDisplayTitleSql,
  type AttachmentRow,
  type EffectRow,
  type PositionVariantRow,
  type ScheduleRow,
  type SessionLeafRow,
  type Prepare,
  type SessionRow,
  type StoredAttachment,
  type StoredSchedule,
} from './storage-rows.js';

// `Storage` stays the module boundary: the row seam is internal, so its
// public types keep reaching callers from here.
export { StorageConflictError, StorageNotFoundError };
export { nextCronRun } from './storage-rows.js';
export {
  searchBotHistory,
  searchHistory,
  searchSessions,
  type BotHistoryMatch,
  type HistoryMatch,
  type SessionMatch,
} from './storage-search.js';
export type { StoredAttachment, StoredSchedule, ContextPosition };

/** Hard engine ceiling for the complete applied variable map of one session. */
const MAX_VARIABLES_PER_SESSION = 256;

interface PositionQuery {
  where: string;
  parameters: readonly (string | number)[];
  order?: 'ASC' | 'DESC';
  limit?: number;
}

export interface StoredSession {
  id: string;
  botSlug: string;
  presetSlug: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  positions: ContextPosition[];
  leaves: CommittedLeaf[];
}

/** The transcript target stored by admission. */
export type TurnTarget =
  | { kind: 'reply'; source: string; attachmentIds?: readonly string[] }
  | { kind: 'swipe'; positionId: string };

export interface VariantWrite {
  sessionId: string;
  positionId: string;
  variantId: string;
  source: string;
  trace: Trace;
  usages: readonly (Usage | null)[];
  provider: string;
  model: string;
  effects?: readonly {
    type: string;
    arguments: Record<string, unknown>;
  }[];
  completedAt: string;
}

export interface AttemptStorageSnapshot {
  session: StoredSession;
  variables: Record<string, string>;
  todos: Todo[];
  previousUserMessageAt: string | null;
  targetSource: string;
  targetAttachments: StoredAttachment[];
  attachmentStorageKeys: ReadonlyMap<string, string>;
}

export interface ExternalEffectOutcome {
  state: 'applied' | 'failed' | 'unresolved';
  result: string;
}

export type ContextEvidence = Pick<
  SessionContext,
  | 'leaves'
  | 'lastRequestUsage'
  | 'lastSwipeCost'
  | 'exactFromExchange'
  | 'currentExchange'
  | 'canCompact'
  | 'todos'
  | 'variables'
  | 'schedules'
>;

/**
 * Positions per transcript page. This is a transport size, not a limit on what
 * the operator may see: `hasMore` and `before` reach the rest. Large enough to
 * fill a tall viewport on the first paint, small enough that opening a
 * year-old conversation costs the same as opening a new one.
 */
const TRANSCRIPT_PAGE_POSITIONS = 50;

/** Provenance for authored greeting variants: no provider call produced them. */
export const GREETING_PROVIDER = 'authored';
export const GREETING_MODEL = 'greeting';

/**
 * The engine's attachment ceiling. Fixed rather than authored: it is one
 * number that has to hold in two places at once — the decoded bytes checked
 * here, and the transport limit the upload route sets from it — and a
 * configured value that only ever moved together with its own transport
 * envelope was a setting with nothing to decide.
 */
export const MAX_ATTACHMENT_BYTES = 10_000_000;

export async function openStorage(
  databasePath: string,
  schemaPath: string,
  attachmentDirectory: string,
): Promise<Storage> {
  const releaseOwnership = await acquireRuntimeOwnership(databasePath);
  try {
    await mkdir(attachmentDirectory, { recursive: true });
    const database = await openDatabase(databasePath, schemaPath);
    try {
      database.transaction(() => {
        const interrupted = database
          .prepare(
            `SELECT p.id FROM message_positions p
         JOIN message_variants v ON v.id = p.selected_variant_id
         WHERE v.source = '' AND v.provider <> 'authored'`,
          )
          .all() as { id: string }[];
        const pendingLeaves = database
          .prepare(`SELECT id FROM leaves WHERE state = 'pending'`)
          .all() as { id: string }[];
        database
          .prepare(
            `UPDATE effects SET state = 'unresolved' WHERE state = 'accepted'`,
          )
          .run();
        database
          .prepare(
            `UPDATE message_variants
         SET source = ?, provider = 'system', model = 'error'
         WHERE source = '' AND provider <> 'authored'`,
          )
          .run(appendSystemError('', INTERRUPTED_ERROR));
        const prepare: Prepare = (sql) => database.prepare(sql);
        for (const { id } of interrupted) syncAssistantSearch(prepare, id);
        database
          .prepare(
            `UPDATE leaves
         SET state = 'committed',
             summary = '[Summary unavailable. Retrieve details if needed.]',
             summary_outcome = 'fallback-unavailable',
             committed_at = CURRENT_TIMESTAMP
         WHERE state = 'pending'`,
          )
          .run();
        for (const { id } of pendingLeaves) publishLeaf(prepare, id);
      })();
      return new Storage(database, attachmentDirectory, releaseOwnership);
    } catch (error) {
      database.close();
      throw error;
    }
  } catch (error) {
    releaseOwnership();
    throw error;
  }
}

/**
 * One schedule's next occurrence, or the reason it has none. Expressions are
 * validated on write, so a failure here is a row this build can no longer
 * read: the operator has to see it and edit it, which means it cannot be
 * thrown (that takes the whole projection) or dropped (that hides the row).
 */
function projectNextRun(
  schedule: { expression: string; enabled: boolean },
  timezone: string,
  at: Date,
): { nextRunAt: string | null; nextRunError: string | null } {
  if (!schedule.enabled) return { nextRunAt: null, nextRunError: null };
  try {
    return {
      nextRunAt: nextCronRun(schedule.expression, timezone, at),
      nextRunError: null,
    };
  } catch (error) {
    return {
      nextRunAt: null,
      nextRunError: error instanceof Error ? error.message : String(error),
    };
  }
}

export class Storage {
  readonly #database: Database.Database;
  readonly #attachmentDirectory: string;
  readonly #releaseOwnership: () => void;

  constructor(
    database: Database.Database,
    attachmentDirectory: string,
    releaseOwnership: () => void,
  ) {
    this.#database = database;
    this.#attachmentDirectory = attachmentDirectory;
    this.#releaseOwnership = releaseOwnership;
  }

  /** The one connection this root writes through. `OwnerAuth` shares it. */
  get connection(): Database.Database {
    return this.#database;
  }

  /** Search reads through the same SQLite connection as conversation writes. */
  readonly statements: Prepare = (sql) => this.#database.prepare(sql);

  close(): void {
    if (!this.#database.open) return;
    try {
      this.#database.close();
    } finally {
      this.#releaseOwnership();
    }
  }

  async backup(destination: string): Promise<void> {
    await this.#database.backup(destination);
  }

  /**
   * Creates one session. `greetings` seeds the authored opening as position 0:
   * the first entry becomes the selected variant and the rest become its
   * swipes. The position stays unlocked so the operator can choose among them
   * until the first reply accepts it.
   */
  createSession(input: {
    id: string;
    botSlug: string;
    presetSlug: string;
    greetings?: readonly string[];
    now: string;
  }) {
    const greetings = input.greetings ?? [];
    return this.#database.transaction(() => {
      this.statements(
        `INSERT INTO sessions (
        id, bot_slug, preset_slug, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)`,
      ).run(input.id, input.botSlug, input.presetSlug, input.now, input.now);
      if (greetings.length > 0) {
        const positionId = randomUUID();
        this.statements(
          `INSERT INTO message_positions (
             id, session_id, ordinal, role, created_at
           ) VALUES (?, ?, 0, 'assistant', ?)`,
        ).run(positionId, input.id, input.now);
        const selectedId = randomUUID();
        for (const [index, source] of greetings.entries()) {
          this.statements(
            `INSERT INTO message_variants (
               id, position_id, ordinal, source, trace_json,
               usage_json, provider, model, created_at
             ) VALUES (?, ?, ?, ?, '[]', '[]', ?, ?, ?)`,
          ).run(
            index === 0 ? selectedId : randomUUID(),
            positionId,
            index + 1,
            source,
            GREETING_PROVIDER,
            GREETING_MODEL,
            input.now,
          );
        }
        this.statements(
          `UPDATE message_positions SET selected_variant_id = ? WHERE id = ?`,
        ).run(selectedId, positionId);
        syncAssistantSearch(this.statements, positionId);
      }
      return {
        id: input.id,
        botSlug: input.botSlug,
        presetSlug: input.presetSlug,
        createdAt: input.now,
      };
    })();
  }

  /** The two authored slugs an attempt resolves against, and nothing else. */
  sessionIdentity(
    sessionId: string,
  ): { botSlug: string; presetSlug: string } | null {
    const row = this.statements(
      `SELECT bot_slug, preset_slug FROM sessions WHERE id = ?`,
    ).get(sessionId) as { bot_slug: string; preset_slug: string } | undefined;
    return row === undefined
      ? null
      : { botSlug: row.bot_slug, presetSlug: row.preset_slug };
  }

  unlockedFinalAssistantPosition(sessionId: string): string | null {
    const row = this.statements(
      `SELECT p.id FROM message_positions p
       JOIN message_variants v ON v.id = p.selected_variant_id
       WHERE p.session_id = ? AND p.role = 'assistant' AND p.locked_at IS NULL
         AND (v.source <> '' OR v.provider = 'authored')
       ORDER BY p.ordinal DESC LIMIT 1`,
    ).get(sessionId) as { id: string } | undefined;
    return row?.id ?? null;
  }

  /** Selected positions after the last active leaf, plus bounded active leaves. */
  loadSession(sessionId: string, activeLeafCap: number): StoredSession | null {
    return this.#database.transaction(() => {
      const session = this.#session(sessionId);
      if (session === undefined) return null;
      const committed = this.#contextLeaves(sessionId, activeLeafCap);
      const coveredThrough = committed.at(-1)?.endOrdinal ?? -1;
      return {
        id: session.id,
        botSlug: session.bot_slug,
        presetSlug: session.preset_slug,
        title: session.title,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
        positions: this.#positions(
          sessionId,
          {
            where: 'p.ordinal > ?',
            parameters: [coveredThrough],
          },
          false,
        ),
        leaves: committed,
      };
    })();
  }

  listSessions(
    botSlug?: string,
    limit?: number,
  ): {
    id: string;
    botSlug: string;
    presetSlug: string;
    title: string;
    updatedAt: string;
  }[] {
    const rows = this.statements(
      `SELECT s.id, s.bot_slug, s.preset_slug, s.updated_at,
              ${sessionDisplayTitleSql('s')} AS display_title
       FROM sessions s
       ${botSlug === undefined ? '' : 'WHERE s.bot_slug = ?'}
       ORDER BY s.updated_at DESC, s.id
       ${limit === undefined ? '' : 'LIMIT ?'}`,
    ).all(
      ...(botSlug === undefined ? [] : [botSlug]),
      ...(limit === undefined ? [] : [limit]),
    ) as {
      id: string;
      bot_slug: string;
      preset_slug: string;
      updated_at: string;
      display_title: string;
    }[];
    return rows.map((row) => ({
      id: row.id,
      botSlug: row.bot_slug,
      presetSlug: row.preset_slug,
      title: row.display_title,
      updatedAt: row.updated_at,
    }));
  }

  setSessionTitle(sessionId: string, title: string, now: string): void {
    const result = this.statements(
      `UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?`,
    ).run(title, now, sessionId);
    if (result.changes === 0)
      throw new StorageNotFoundError('Session not found');
  }

  setSessionPreset(sessionId: string, presetSlug: string, now: string): void {
    const result = this.statements(
      'UPDATE sessions SET preset_slug = ?, updated_at = ? WHERE id = ?',
    ).run(presetSlug, now, sessionId);
    if (result.changes === 0)
      throw new StorageNotFoundError('Session not found');
  }

  async deleteSession(sessionId: string): Promise<void> {
    const keys = this.#database.transaction(() => {
      const rows = this.statements(
        `SELECT storage_key FROM attachments WHERE session_id = ?`,
      ).all(sessionId) as { storage_key: string }[];
      const result = this.statements(`DELETE FROM sessions WHERE id = ?`).run(
        sessionId,
      );
      if (result.changes === 0)
        throw new StorageNotFoundError('Session not found');
      return rows.map((row) => row.storage_key);
    })();
    await this.#unlinkAttachments(keys);
  }

  /** A bound attachment cannot match, so a completed admission makes this a no-op. */
  async discardUnboundAttachments(
    sessionId: string,
    ids: readonly string[],
  ): Promise<void> {
    if (ids.length === 0) return;
    const discarded = this.statements(
      `DELETE FROM attachments
       WHERE session_id = ? AND position_id IS NULL
         AND id IN (${placeholders(ids)})
       RETURNING storage_key`,
    ).all(sessionId, ...ids) as { storage_key: string }[];
    await this.#unlinkAttachments(discarded.map((row) => row.storage_key));
  }

  async #unlinkAttachments(keys: readonly string[]): Promise<void> {
    await Promise.all(
      keys.map((key) =>
        unlink(join(this.#attachmentDirectory, key)).catch(() => undefined),
      ),
    );
  }

  loadAttemptSnapshot(
    sessionId: string,
    positionId: string,
    variantId: string,
    activeLeafCap: number,
  ): AttemptStorageSnapshot | null {
    return this.#database.transaction(() => {
      const session = this.loadSession(sessionId, activeLeafCap);
      if (session === null) return null;
      const targetIndex = session.positions.findIndex(
        (position) => position.id === positionId,
      );
      const target = session.positions[targetIndex];
      const user = session.positions[targetIndex - 1];
      if (
        targetIndex !== session.positions.length - 1 ||
        target?.role !== 'assistant' ||
        target.locked ||
        target.variant.id !== variantId ||
        target.variant.source !== '' ||
        user?.role !== 'user'
      )
        return null;
      const attachmentIds = session.positions.flatMap((position) =>
        position.role === 'user'
          ? position.attachments.map((attachment) => attachment.id)
          : [],
      );
      const rows =
        attachmentIds.length === 0
          ? []
          : (this.statements(
              `SELECT id, storage_key
               FROM attachments
               WHERE session_id = ?
                 AND id IN (${placeholders(attachmentIds)})`,
            ).all(sessionId, ...attachmentIds) as {
              id: string;
              storage_key: string;
            }[]);
      return {
        session,
        variables: this.sessionVariables(sessionId),
        todos: this.listTodos(sessionId),
        previousUserMessageAt: this.previousUserMessageAt(
          sessionId,
          positionId,
        ),
        targetSource: user.source,
        targetAttachments: user.attachments,
        attachmentStorageKeys: new Map(
          rows.map((row) => [row.id, row.storage_key]),
        ),
      };
    })();
  }

  /** Accepted session variables for one immutable model-input snapshot. */
  sessionVariables(sessionId: string): Record<string, string> {
    return Object.fromEntries(
      this.#listVariables(sessionId).map(({ name, value }) => [name, value]),
    );
  }

  /** Previous canonical user message before one assistant position. */
  previousUserMessageAt(sessionId: string, positionId: string): string | null {
    const row = this.statements(
      `SELECT prior.created_at
       FROM message_positions current
       JOIN message_positions prior
         ON prior.session_id = current.session_id
        AND prior.role = 'user'
        AND prior.ordinal < current.ordinal - 1
       WHERE current.id = ? AND current.session_id = ?
       ORDER BY prior.ordinal DESC LIMIT 1`,
    ).get(positionId, sessionId) as { created_at: string } | undefined;
    return row?.created_at ?? null;
  }

  /** Stores the canonical empty response before assembly or provider work. */
  admitAttempt(input: {
    sessionId: string;
    target: TurnTarget;
    variantId: string;
    now: string;
  }): { positionId: string; variantId: string } {
    return this.#database.transaction(() => {
      const positionId =
        input.target.kind === 'swipe'
          ? input.target.positionId
          : this.#openTurn(input.sessionId, input.target, input.now);
      const position = this.statements(
        `SELECT COALESCE(MAX(v.ordinal), 0) + 1 AS ordinal
         FROM message_positions p
         LEFT JOIN message_variants v ON v.position_id = p.id
         WHERE p.id = ? AND p.session_id = ? AND p.role = 'assistant'
           AND p.locked_at IS NULL
         GROUP BY p.id`,
      ).get(positionId, input.sessionId) as { ordinal: number } | undefined;
      if (position === undefined)
        throw new StorageConflictError(
          'Assistant position is missing or locked',
        );
      this.statements(
        `INSERT INTO message_variants (
          id, position_id, ordinal, source, trace_json,
          usage_json, provider, model, created_at
        ) VALUES (?, ?, ?, '', '[]', '[]', 'system', 'pending', ?)`,
      ).run(input.variantId, positionId, position.ordinal, input.now);
      this.statements(
        `UPDATE message_positions SET selected_variant_id = ? WHERE id = ?`,
      ).run(input.variantId, positionId);
      this.#touch(input.sessionId, input.now);
      return { positionId, variantId: input.variantId };
    })();
  }

  /** Completes the admitted variant once. Empty source is reserved for admission. */
  finalizeVariant(write: VariantWrite): void {
    if (write.source.length === 0)
      throw new StorageConflictError('A completed response cannot be empty');
    this.#database.transaction(() => {
      const result = this.statements(
        `UPDATE message_variants
         SET source = ?, trace_json = ?, usage_json = ?,
             provider = ?, model = ?
         WHERE id = ? AND position_id = ? AND source = ''`,
      ).run(
        write.source,
        JSON.stringify(write.trace),
        JSON.stringify(write.usages),
        write.provider,
        write.model,
        write.variantId,
        write.positionId,
      );
      if (result.changes === 0)
        throw new StorageConflictError('Admitted variant cannot be completed');
      for (const [ordinal, effect] of (write.effects ?? []).entries()) {
        this.statements(
          `INSERT INTO effects (
             id, session_id, position_id, variant_id, ordinal, type,
             arguments_json, state, created_at
           )
           SELECT ?, session_id, id, ?, ?, ?, ?, ?, ?
           FROM message_positions WHERE id = ?`,
        ).run(
          randomUUID(),
          write.variantId,
          ordinal,
          effect.type,
          JSON.stringify(effect.arguments),
          'candidate',
          write.completedAt,
          write.positionId,
        );
      }
      syncAssistantSearch(this.statements, write.positionId);
      this.#touch(write.sessionId, write.completedAt);
    })();
  }

  /** The user position and the empty assistant position that answers it. */
  #openTurn(
    sessionId: string,
    turn: Extract<TurnTarget, { kind: 'reply' }>,
    now: string,
  ): string {
    const session = this.statements(
      `SELECT COALESCE(MAX(p.ordinal), -1) + 1 AS user_ordinal
       FROM sessions s
       LEFT JOIN message_positions p ON p.session_id = s.id
       WHERE s.id = ? GROUP BY s.id`,
    ).get(sessionId) as { user_ordinal: number } | undefined;
    if (session === undefined)
      throw new StorageNotFoundError('Session not found');

    const userPositionId = randomUUID();
    this.statements(
      `INSERT INTO message_positions (
        id, session_id, ordinal, role, source, created_at
      ) VALUES (?, ?, ?, 'user', ?, ?)`,
    ).run(userPositionId, sessionId, session.user_ordinal, turn.source, now);

    const attachmentIds = turn.attachmentIds ?? [];
    if (attachmentIds.length > 0) {
      const attached = this.statements(
        `UPDATE attachments SET position_id = ?
         WHERE session_id = ? AND position_id IS NULL
           AND id IN (${placeholders(attachmentIds)})`,
      ).run(userPositionId, sessionId, ...attachmentIds);
      if (attached.changes !== attachmentIds.length) {
        throw new StorageConflictError('Attachment is unavailable');
      }
    }
    this.statements(
      `INSERT INTO search_documents (handle, session_id, kind, ordinal, source)
       VALUES (?, ?, 'message', ?, ?)`,
    ).run(
      `position:${userPositionId}`,
      sessionId,
      session.user_ordinal,
      turn.source,
    );

    const assistantPositionId = randomUUID();
    this.statements(
      `INSERT INTO message_positions (
        id, session_id, ordinal, role, created_at
      ) VALUES (?, ?, ?, 'assistant', ?)`,
    ).run(assistantPositionId, sessionId, session.user_ordinal + 1, now);
    return assistantPositionId;
  }

  async importAttachment(input: {
    sessionId: string;
    filename: string;
    data: Buffer;
    maxDimension: number;
    now: string;
  }): Promise<StoredAttachment> {
    if (this.sessionIdentity(input.sessionId) === null)
      throw new StorageNotFoundError('Session not found');
    if (input.data.length === 0 || input.data.length > MAX_ATTACHMENT_BYTES) {
      throw new StorageConflictError('Image size is outside the allowed range');
    }
    const image = inspectImage(input.data);
    if (image.width > input.maxDimension || image.height > input.maxDimension) {
      throw new StorageConflictError('Image dimensions exceed the limit');
    }
    const id = randomUUID();
    const storageKey = `${id}.${image.mimeType === 'image/png' ? 'png' : 'jpg'}`;
    const finalPath = join(this.#attachmentDirectory, storageKey);
    const temporaryPath = `${finalPath}.tmp`;
    await writeFile(temporaryPath, input.data, { flag: 'wx' });
    await rename(temporaryPath, finalPath);
    try {
      this.statements(
        `INSERT INTO attachments (
           id, session_id, storage_key, filename, mime_type, byte_size,
           width, height, sha256, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.sessionId,
        storageKey,
        input.filename,
        image.mimeType,
        input.data.length,
        image.width,
        image.height,
        createHash('sha256').update(input.data).digest('hex'),
        input.now,
      );
    } catch (error) {
      await unlink(finalPath).catch(() => undefined);
      throw error;
    }
    return {
      id,
      filename: input.filename,
      mimeType: image.mimeType,
      byteSize: input.data.length,
      width: image.width,
      height: image.height,
    };
  }

  async readAttachmentFile(storageKey: string): Promise<Buffer> {
    return readFile(join(this.#attachmentDirectory, storageKey));
  }

  async readSessionAttachment(
    sessionId: string,
    attachmentId: string,
  ): Promise<{ data: Buffer; mimeType: 'image/png' | 'image/jpeg' }> {
    const row = this.statements(
      `SELECT storage_key, mime_type FROM attachments
       WHERE id = ? AND session_id = ? AND position_id IS NOT NULL`,
    ).get(attachmentId, sessionId) as
      | { storage_key: string; mime_type: 'image/png' | 'image/jpeg' }
      | undefined;
    if (row === undefined)
      throw new StorageNotFoundError('Attachment not found');
    return {
      data: await this.readAttachmentFile(row.storage_key),
      mimeType: row.mime_type,
    };
  }

  /** The server owns sibling ordering; the client names only a direction. */
  selectAdjacentVariant(input: {
    sessionId: string;
    positionId: string;
    direction: 'previous' | 'next';
    now: string;
  }): void {
    this.#database.transaction(() => {
      const position = this.statements(
        `SELECT selected.ordinal FROM message_positions p
         JOIN message_variants selected ON selected.id = p.selected_variant_id
         WHERE p.id = ? AND p.session_id = ? AND p.role = 'assistant'
           AND p.locked_at IS NULL AND (selected.source <> '' OR selected.provider = 'authored')`,
      ).get(input.positionId, input.sessionId) as
        { ordinal: number } | undefined;
      if (position === undefined)
        throw new StorageConflictError(
          'Variant cannot be selected for this position',
        );
      const previous = input.direction === 'previous';
      const neighbour = this.statements(
        `SELECT id FROM message_variants
         WHERE position_id = ? AND ordinal ${previous ? '<' : '>'} ?
         ORDER BY ordinal ${previous ? 'DESC' : 'ASC'} LIMIT 1`,
      ).get(input.positionId, position.ordinal) as { id: string } | undefined;
      if (neighbour === undefined)
        throw new StorageConflictError('No variant lies in that direction');
      this.statements(
        `UPDATE message_positions SET selected_variant_id = ? WHERE id = ?`,
      ).run(neighbour.id, input.positionId);
      syncAssistantSearch(this.statements, input.positionId);
      this.#touch(input.sessionId, input.now);
    })();
  }

  acceptPosition(
    sessionId: string,
    positionId: string,
    now: string,
  ): Usage | null {
    return this.#database.transaction(() => {
      const selected = this.statements(
        `SELECT v.usage_json
         FROM message_positions p
         JOIN message_variants v ON v.id = p.selected_variant_id
         WHERE p.id = ? AND p.session_id = ? AND p.role = 'assistant'
           AND p.locked_at IS NULL AND (v.source <> '' OR v.provider = 'authored')`,
      ).get(positionId, sessionId) as { usage_json: string } | undefined;
      if (selected === undefined)
        throw new StorageConflictError('Position cannot be accepted');
      const usage =
        usageSchema
          .nullable()
          .array()
          .parse(JSON.parse(selected.usage_json))
          .at(-1) ?? null;
      this.statements(
        `UPDATE message_positions SET locked_at = ? WHERE id = ?`,
      ).run(now, positionId);
      this.#acceptSelectedEffects(positionId);
      this.#touch(sessionId, now);
      return usage;
    })();
  }

  async drainEffects(
    sessionId: string,
    now: string,
    timezone: string,
    applyMemoryRetention?: (
      type: string,
      arguments_: Record<string, unknown>,
    ) => Promise<ExternalEffectOutcome>,
  ): Promise<boolean> {
    let schedulesChanged = false;
    while (true) {
      const effect = this.statements(
        `SELECT e.id, e.type, e.arguments_json
         FROM effects e
         JOIN message_positions p ON p.id = e.position_id
         WHERE e.session_id = ? AND e.state = 'accepted'
         ORDER BY p.ordinal, e.ordinal LIMIT 1`,
      ).get(sessionId) as
        { id: string; type: string; arguments_json: string } | undefined;
      if (effect === undefined) return schedulesChanged;
      const arguments_ = unknownRecordSchema.parse(
        JSON.parse(effect.arguments_json),
      );
      if (
        ![
          'todo_add',
          'todo_update',
          'variable_set',
          'variable_delete',
          'schedule_set',
          'schedule_delete',
        ].includes(effect.type)
      ) {
        try {
          const outcome =
            applyMemoryRetention === undefined
              ? {
                  state: 'failed' as const,
                  result: 'Memory retention executor is unavailable',
                }
              : await applyMemoryRetention(effect.type, arguments_);
          this.#completeEffect(effect.id, outcome.state, outcome.result, now);
        } catch (error) {
          this.#completeEffect(
            effect.id,
            'unresolved',
            error instanceof Error ? error.message : String(error),
            now,
          );
        }
        continue;
      }
      try {
        this.#database.transaction(() => {
          if (
            effect.type === 'variable_set' &&
            typeof arguments_.name === 'string' &&
            typeof arguments_.value === 'string'
          ) {
            this.setVariable(sessionId, arguments_.name, arguments_.value, now);
            this.#completeEffect(effect.id, 'applied', arguments_.value, now);
          } else if (
            effect.type === 'variable_delete' &&
            typeof arguments_.name === 'string'
          ) {
            this.statements(
              `DELETE FROM session_variables WHERE session_id = ? AND name = ?`,
            ).run(sessionId, arguments_.name);
            this.#completeEffect(effect.id, 'applied', 'deleted', now);
          } else if (effect.type === 'todo_add') {
            const todo = todoSchema.parse(arguments_);
            this.addTodo(sessionId, todo, now);
            this.#completeEffect(
              effect.id,
              'applied',
              `Added ${todo.title}`,
              now,
            );
          } else if (effect.type === 'todo_update') {
            this.updateTodo(sessionId, todoUpdateSchema.parse(arguments_), now);
            this.#completeEffect(effect.id, 'applied', 'Updated to-do', now);
          } else if (effect.type === 'schedule_set') {
            const schedule = parseScheduleEffect(arguments_);
            this.putSchedule(
              {
                ...schedule,
                id: schedule.id ?? randomUUID(),
                sessionId,
                now,
              },
              timezone,
            );
            this.#completeEffect(effect.id, 'applied', 'scheduled', now);
          } else if (
            effect.type === 'schedule_delete' &&
            typeof arguments_.id === 'string'
          ) {
            this.deleteSchedule(sessionId, arguments_.id, now);
            this.#completeEffect(effect.id, 'applied', 'deleted', now);
          } else {
            throw new Error(`Unknown internal effect: ${effect.type}`);
          }
        })();
        if (effect.type === 'schedule_set' || effect.type === 'schedule_delete')
          schedulesChanged = true;
      } catch (error) {
        this.#completeEffect(
          effect.id,
          'failed',
          error instanceof Error ? error.message : String(error),
          now,
        );
      }
    }
  }

  setVariable(
    sessionId: string,
    name: string,
    value: string,
    now: string,
    previousName?: string,
  ): void {
    this.#database.transaction(() => {
      if (this.sessionIdentity(sessionId) === null)
        throw new StorageNotFoundError('Session not found');
      const current = this.sessionVariables(sessionId);
      if (previousName !== undefined && previousName !== name) {
        if (!Object.hasOwn(current, previousName))
          throw new StorageNotFoundError('Variable not found');
        if (Object.hasOwn(current, name))
          throw new StorageConflictError('Variable name already exists');
        this.statements(
          `UPDATE session_variables SET name = ?, value = ?
           WHERE session_id = ? AND name = ?`,
        ).run(name, value, sessionId, previousName);
      } else {
        if (
          !Object.hasOwn(current, name) &&
          Object.keys(current).length >= MAX_VARIABLES_PER_SESSION
        )
          throw new StorageConflictError(
            `Variable limit of ${String(MAX_VARIABLES_PER_SESSION)} reached`,
          );
        this.statements(
          `INSERT INTO session_variables (session_id, name, value) VALUES (?, ?, ?)
           ON CONFLICT(session_id, name) DO UPDATE SET value = excluded.value`,
        ).run(sessionId, name, value);
      }
      this.#touch(sessionId, now);
    })();
  }

  deleteVariable(sessionId: string, name: string, now: string): void {
    const result = this.statements(
      `DELETE FROM session_variables WHERE session_id = ? AND name = ?`,
    ).run(sessionId, name);
    if (result.changes === 0)
      throw new StorageNotFoundError('Variable not found');
    this.#touch(sessionId, now);
  }

  listTodos(sessionId: string): Todo[] {
    return this.statements(
      `SELECT id, title, due, note FROM session_todos
       WHERE session_id = ? ORDER BY due IS NULL, due, rowid`,
    ).all(sessionId) as Todo[];
  }

  addTodo(sessionId: string, todo: Todo, now: string): void {
    this.#database.transaction(() => {
      if (this.sessionIdentity(sessionId) === null)
        throw new StorageNotFoundError('Session not found');
      if (this.listTodos(sessionId).length >= MAX_TODOS)
        throw new StorageConflictError(
          `To-do limit of ${String(MAX_TODOS)} reached`,
        );
      this.statements(
        `INSERT INTO session_todos (session_id, id, title, due, note) VALUES (?, ?, ?, ?, ?)`,
      ).run(sessionId, todo.id, todo.title, todo.due, todo.note);
      this.#touch(sessionId, now);
    })();
  }

  updateTodo(sessionId: string, update: TodoUpdate, now: string): void {
    this.#database.transaction(() => {
      const current = this.listTodos(sessionId).find(
        (todo) => todo.id === update.id,
      );
      if (current === undefined)
        throw new StorageNotFoundError('To-do not found');
      if (update.status !== undefined && update.status !== 'open') {
        this.statements(
          'DELETE FROM session_todos WHERE session_id = ? AND id = ?',
        ).run(sessionId, update.id);
      } else {
        this.statements(
          `UPDATE session_todos SET title = ?, due = ?, note = ? WHERE session_id = ? AND id = ?`,
        ).run(
          update.title ?? current.title,
          update.due === undefined ? current.due : update.due,
          update.note ?? current.note,
          sessionId,
          update.id,
        );
      }
      this.#touch(sessionId, now);
    })();
  }

  listSchedules(sessionId?: string): StoredSchedule[] {
    const rows = this.statements(
      `SELECT id, session_id, name, expression, prompt, enabled
       FROM schedules ${sessionId === undefined ? '' : 'WHERE session_id = ?'}
       ORDER BY id`,
    ).all(...(sessionId === undefined ? [] : [sessionId])) as ScheduleRow[];
    return rows.map(decodeSchedule);
  }

  putSchedule(
    input: ScheduleWrite & {
      id: string;
      sessionId: string;
      now: string;
    },
    timezone: string,
  ): void {
    if (this.sessionIdentity(input.sessionId) === null)
      throw new StorageNotFoundError('Session not found');
    nextCronRun(input.expression, timezone, new Date(input.now));
    const result = this.statements(
      `INSERT INTO schedules (
         id, session_id, name, expression, prompt, enabled
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, expression = excluded.expression,
         prompt = excluded.prompt, enabled = excluded.enabled
       WHERE schedules.session_id = excluded.session_id`,
    ).run(
      input.id,
      input.sessionId,
      input.name,
      input.expression,
      input.prompt,
      input.enabled ? 1 : 0,
    );
    if (result.changes === 0)
      throw new StorageNotFoundError('Schedule not found');
    this.#touch(input.sessionId, input.now);
  }

  deleteSchedule(sessionId: string, id: string, now: string): void {
    const result = this.statements(
      `DELETE FROM schedules WHERE id = ? AND session_id = ?`,
    ).run(id, sessionId);
    if (result.changes === 0)
      throw new StorageNotFoundError('Schedule not found');
    this.#touch(sessionId, now);
  }

  editPositionSource(input: {
    sessionId: string;
    positionId: string;
    source: string;
    now: string;
  }): void {
    this.#database.transaction(() => {
      if (input.source.length === 0)
        throw new StorageConflictError('A user message cannot be empty');
      const result = this.statements(
        `UPDATE message_positions SET source = ?
         WHERE id = ? AND session_id = ? AND role = 'user'
           AND NOT EXISTS (
             SELECT 1 FROM message_positions answer
             JOIN message_variants v ON v.id = answer.selected_variant_id
             WHERE answer.session_id = message_positions.session_id
               AND answer.ordinal = message_positions.ordinal + 1
               AND v.source = ''
           )`,
      ).run(input.source, input.positionId, input.sessionId);
      if (result.changes === 0)
        throw new StorageNotFoundError('User position not found');
      this.statements(
        `UPDATE search_documents SET source = ? WHERE handle = ?`,
      ).run(input.source, `position:${input.positionId}`);
      this.#touch(input.sessionId, input.now);
    })();
  }

  editVariantSource(input: {
    sessionId: string;
    variantId: string;
    source: string;
    now: string;
  }): { positionId: string } {
    return this.#database.transaction(() => {
      if (input.source.length === 0)
        throw new StorageConflictError('A completed response cannot be empty');
      const position = this.statements(
        `UPDATE message_variants SET source = ?
         WHERE id = ? AND (source <> '' OR provider = 'authored') AND position_id IN (
           SELECT p.id FROM message_positions p
           JOIN message_variants selected ON selected.id = p.selected_variant_id
           WHERE p.session_id = ? AND (selected.source <> '' OR selected.provider = 'authored')
         ) RETURNING position_id`,
      ).get(input.source, input.variantId, input.sessionId) as
        { position_id: string } | undefined;
      if (position === undefined)
        throw new StorageNotFoundError('Variant not found');
      syncAssistantSearch(this.statements, position.position_id);
      this.#touch(input.sessionId, input.now);
      return { positionId: position.position_id };
    })();
  }

  deleteVariant(input: { sessionId: string; variantId: string; now: string }): {
    positionId: string;
  } {
    return this.#database.transaction(() => {
      const variant = this.statements(
        `SELECT v.position_id
         FROM message_variants v
         JOIN message_positions p ON p.id = v.position_id
         JOIN message_variants selected ON selected.id = p.selected_variant_id
         WHERE v.id = ? AND p.session_id = ? AND p.locked_at IS NULL
           AND (selected.source <> '' OR selected.provider = 'authored')`,
      ).get(input.variantId, input.sessionId) as
        { position_id: string } | undefined;
      if (variant === undefined)
        throw new StorageConflictError('Variant cannot be deleted');

      const replacement = this.statements(
        `SELECT id FROM message_variants
         WHERE position_id = ? AND id <> ? ORDER BY ordinal LIMIT 1`,
      ).get(variant.position_id, input.variantId) as { id: string } | undefined;
      if (replacement === undefined)
        throw new StorageConflictError('The final variant cannot be deleted');

      this.statements(
        `UPDATE message_positions SET selected_variant_id = ?
         WHERE id = ? AND selected_variant_id = ?`,
      ).run(replacement.id, variant.position_id, input.variantId);
      this.statements(`DELETE FROM message_variants WHERE id = ?`).run(
        input.variantId,
      );
      syncAssistantSearch(this.statements, variant.position_id);
      this.#touch(input.sessionId, input.now);
      return { positionId: variant.position_id };
    })();
  }

  resolveEffect(input: { sessionId: string; effectId: string; now: string }): {
    positionId: string;
  } {
    const position = this.statements(
      `UPDATE effects
       SET state = 'failed', result = 'Marked resolved by operator', completed_at = ?
       WHERE id = ? AND session_id = ? AND state = 'unresolved'
       RETURNING position_id`,
    ).get(input.now, input.effectId, input.sessionId) as
      { position_id: string } | undefined;
    if (position === undefined)
      throw new StorageConflictError('Effect cannot be marked resolved');
    this.#touch(input.sessionId, input.now);
    return { positionId: position.position_id };
  }

  /** Session-wide state: bounded by construction, so it rides every response. */

  #session(sessionId: string): SessionRow | undefined {
    return this.statements(
      `SELECT id, bot_slug, preset_slug, title, created_at, updated_at
       FROM sessions WHERE id = ?`,
    ).get(sessionId) as SessionRow | undefined;
  }

  /** One canonical join, with inspection fields only for client reads. */
  #positions(
    sessionId: string,
    query: PositionQuery,
    inspect: false,
  ): ContextPosition[];
  #positions(sessionId: string, query: PositionQuery): MessagePosition[];
  #positions(
    sessionId: string,
    query: PositionQuery,
    inspect = true,
  ): ContextPosition[] {
    const rows = this.statements(
      `SELECT
        p.id AS position_id,
        p.ordinal AS position_ordinal,
        p.role,
        p.source AS position_source,
        p.selected_variant_id,
        p.locked_at,
        p.created_at AS position_created_at,
        v.id AS variant_id,
        v.ordinal AS variant_ordinal,
        v.source AS variant_source,
        v.provider,
        v.model,
        ${inspect ? 'v.trace_json,' : ''}
        v.usage_json,
        v.created_at AS variant_created_at
        ${
          inspect
            ? `, (SELECT COUNT(*) FROM message_variants w
          WHERE w.position_id = p.id AND w.ordinal < v.ordinal) AS variant_index,
        (SELECT COUNT(*) FROM message_variants w
          WHERE w.position_id = p.id) AS variant_count`
            : ''
        }
      FROM message_positions p
      LEFT JOIN message_variants v ON v.id = p.selected_variant_id
      WHERE p.session_id = ? AND ${query.where}
      ORDER BY p.ordinal ${query.order ?? 'ASC'}
      ${query.limit === undefined ? '' : 'LIMIT ?'}`,
    ).all(
      sessionId,
      ...query.parameters,
      ...(query.limit === undefined ? [] : [query.limit]),
    ) as PositionVariantRow[];
    if (rows.length === 0) return [];

    const positionIds = rows.map((row) => row.position_id);
    const variantIds = rows
      .map((row) => row.variant_id)
      .filter((value): value is string => value !== null);
    const effects =
      !inspect || variantIds.length === 0
        ? []
        : (this.statements(
            `SELECT id, variant_id, ordinal, type, arguments_json, state, result
             FROM effects
             WHERE session_id = ? AND variant_id IN (${placeholders(variantIds)})
             ORDER BY position_id, ordinal`,
          ).all(sessionId, ...variantIds) as EffectRow[]);
    const attachments = this.statements(
      `SELECT id, position_id, storage_key, filename, mime_type,
              byte_size, width, height
       FROM attachments
       WHERE session_id = ? AND position_id IN (${placeholders(positionIds)})
       ORDER BY rowid`,
    ).all(sessionId, ...positionIds) as AttachmentRow[];
    return inspect
      ? decodePositions(rows, effects, attachments)
      : decodeContextPositions(rows, attachments);
  }

  /** The newest committed leaves admitted by the cap, in context order. */
  #contextLeaves(sessionId: string, activeLeafCap: number): CommittedLeaf[] {
    return (
      this.statements(
        `SELECT id, start_ordinal, end_ordinal, trigger_position_id,
                state, summary, summary_outcome, created_at
         FROM leaves
         WHERE session_id = ? AND state = 'committed'
         ORDER BY start_ordinal DESC LIMIT ?`,
      ).all(sessionId, activeLeafCap) as SessionLeafRow[]
    )
      .map(decodeLeaf)
      .reverse();
  }

  #sessionState(sessionId: string): SessionState {
    const session = this.#session(sessionId);
    if (session === undefined)
      throw new StorageNotFoundError('Session not found');
    return {
      id: session.id,
      botSlug: session.bot_slug,
      presetSlug: session.preset_slug,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
    };
  }

  projection(sessionId: string): Omit<SessionProjection, 'activeAttemptId'> {
    return {
      ...this.#sessionState(sessionId),
      page: this.transcriptPage(sessionId, null),
    };
  }

  /** Read newest-first, then return the bounded page in transcript order. */
  transcriptPage(sessionId: string, before: number | null): TranscriptPage {
    return this.#database.transaction(() => {
      const positions = this.#positions(sessionId, {
        where: 'p.ordinal < ?',
        parameters: [before ?? Number.MAX_SAFE_INTEGER],
        order: 'DESC',
        limit: TRANSCRIPT_PAGE_POSITIONS + 1,
      });
      return {
        positions: positions.slice(0, TRANSCRIPT_PAGE_POSITIONS).reverse(),
        hasMore: positions.length > TRANSCRIPT_PAGE_POSITIONS,
      };
    })();
  }

  /** Current session state plus the positions named by a mutation. */
  sessionChange(input: {
    sessionId: string;
    positionIds?: readonly string[];
  }): SessionChange {
    const positionIds = input.positionIds ?? [];
    return this.#database.transaction(() => ({
      ...this.#sessionState(input.sessionId),
      positions:
        positionIds.length === 0
          ? []
          : this.#positions(input.sessionId, {
              where: `p.id IN (${placeholders(positionIds)})`,
              parameters: positionIds,
            }),
    }))();
  }

  /** Persist coverage; keep the frozen summary input only for this call. */
  createPendingLeaf(input: {
    sessionId: string;
    liveTailExchanges: number;
    now: string;
  }) {
    return this.#database.transaction(() => {
      const range = this.#prospectiveCompactionRange(
        input.sessionId,
        input.liveTailExchanges,
      );
      if (range === null) return null;
      const { triggerPositionId, priorLeafId, startOrdinal, endOrdinal } =
        range;
      const source = this.#rangeSource(
        input.sessionId,
        startOrdinal,
        endOrdinal,
      );
      if (source.length === 0) return null;
      const id = randomUUID();
      this.statements(
        `INSERT INTO leaves (
           id, session_id, start_ordinal, end_ordinal, prior_leaf_id,
           trigger_position_id, state, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      ).run(
        id,
        input.sessionId,
        startOrdinal,
        endOrdinal,
        priorLeafId,
        triggerPositionId,
        input.now,
      );
      return { id, ...range, source };
    })();
  }

  /** Render a committed leaf's range from the current canonical transcript. */
  leafRegenerationInput(sessionId: string, leafId: string) {
    return this.#database.transaction(() => {
      const row = this.statements(
        `SELECT start_ordinal, end_ordinal, prior_leaf_id, trigger_position_id
         FROM leaves WHERE id = ? AND session_id = ? AND state = 'committed'`,
      ).get(leafId, sessionId) as
        | {
            start_ordinal: number;
            end_ordinal: number;
            prior_leaf_id: string | null;
            trigger_position_id: string;
          }
        | undefined;
      if (row === undefined)
        throw new StorageNotFoundError('Committed leaf not found');
      return {
        source: this.#rangeSource(
          sessionId,
          row.start_ordinal,
          row.end_ordinal,
        ),
        priorLeafId: row.prior_leaf_id,
        triggerPositionId: row.trigger_position_id,
      };
    })();
  }

  /** Replace the current summary, including edits made during regeneration. */
  regenerateLeaf(input: {
    sessionId: string;
    leafId: string;
    summary: string;
    summaryOutcome: CommittedLeaf['summaryOutcome'];
    now: string;
  }): void {
    this.#database.transaction(() => {
      const result = this.statements(
        `UPDATE leaves
         SET summary = ?, summary_outcome = ?, committed_at = ?
         WHERE id = ? AND session_id = ? AND state = 'committed'`,
      ).run(
        input.summary,
        input.summaryOutcome,
        input.now,
        input.leafId,
        input.sessionId,
      );
      if (result.changes === 0)
        throw new StorageNotFoundError('Committed leaf not found');
      publishLeaf(this.statements, input.leafId);
      this.#touch(input.sessionId, input.now);
    })();
  }

  /** Summary-call input for selected canonical content in an ordinal range. */
  #rangeSource(
    sessionId: string,
    startOrdinal: number,
    endOrdinal: number,
  ): string {
    return this.#positions(
      sessionId,
      {
        where: 'p.ordinal BETWEEN ? AND ?',
        parameters: [startOrdinal, endOrdinal],
      },
      false,
    )
      .map((position) => {
        if (position.role === 'user') {
          const images = position.attachments
            .map((attachment) => `[Image attachment: ${attachment.filename}]`)
            .join('\n');
          return `User:\n${position.source}${images.length === 0 ? '' : `\n${images}`}`;
        }
        return position.variant.source.trim() === ''
          ? ''
          : `Assistant:\n${position.variant.source}`;
      })
      .filter(Boolean)
      .join('\n\n');
  }

  /** One prior summary, for continuity anchoring. */
  leafSummary(leafId: string): string | null {
    const row = this.statements(`SELECT summary FROM leaves WHERE id = ?`).get(
      leafId,
    ) as { summary: string | null } | undefined;
    return row?.summary ?? null;
  }

  commitLeaf(
    leafId: string,
    summary: string,
    summaryOutcome: CommittedLeaf['summaryOutcome'],
    now: string,
  ): void {
    this.#database.transaction(() => {
      const result = this.statements(
        `UPDATE leaves
         SET state = 'committed', summary = ?, summary_outcome = ?, committed_at = ?
         WHERE id = ? AND state = 'pending'
         RETURNING id`,
      ).get(summary, summaryOutcome, now, leafId);
      if (result === undefined)
        throw new StorageConflictError('Pending leaf not found');
      publishLeaf(this.statements, leafId);
    })();
  }

  contextEvidence(
    sessionId: string,
    activeLeafCap: number,
    timezone: string,
    at = new Date(),
    liveTailExchanges = 1,
  ): ContextEvidence {
    return this.#database.transaction(() => {
      if (this.#session(sessionId) === undefined)
        throw new StorageNotFoundError('Session not found');
      const variables = this.#listVariables(sessionId);
      const schedules = this.listSchedules(sessionId).map(
        ({ sessionId: _sessionId, ...schedule }) => ({
          ...schedule,
          ...projectNextRun(schedule, timezone, at),
        }),
      );
      return this.#contextEvidence(
        sessionId,
        activeLeafCap,
        liveTailExchanges,
        variables,
        schedules,
      );
    })();
  }

  #contextEvidence(
    sessionId: string,
    activeLeafCap: number,
    liveTailExchanges: number,
    variables: SessionContext['variables'],
    schedules: SessionContext['schedules'],
  ): ContextEvidence {
    const leaves = this.#contextLeaves(sessionId, activeLeafCap).map(
      (leaf) => ({
        ...leaf,
        startExchange: 0,
        endExchange: 0,
      }),
    );
    const exactFromOrdinal = (leaves.at(-1)?.endOrdinal ?? -1) + 1;
    let currentExchange = 0;
    let exactFromExchange = 1;
    // One scan for the usual bounded leaf set. Batches keep arbitrary authored
    // caps within SQLite's column/parameter limits without storing counters.
    for (let offset = 0; offset < Math.max(1, leaves.length); offset += 100) {
      const batch = leaves.slice(offset, offset + 100);
      const counts = this.statements(
        `SELECT COUNT(*) AS total,
        COUNT(CASE WHEN ordinal < ? THEN 1 END) + 1 AS exact
        ${batch
          .map(
            (_, index) => `,
          COUNT(CASE WHEN ordinal < ? THEN 1 END) + 1 AS start${String(index)},
          COUNT(CASE WHEN ordinal <= ? THEN 1 END) AS end${String(index)}`,
          )
          .join('')}
        FROM message_positions WHERE session_id = ? AND role = 'assistant'
      `,
      ).get(
        exactFromOrdinal,
        ...batch.flatMap((leaf) => [leaf.startOrdinal, leaf.endOrdinal]),
        sessionId,
      ) as { total: number; exact: number } & Record<string, number>;
      currentExchange = counts.total;
      exactFromExchange = counts.exact;
      for (const [index, leaf] of batch.entries()) {
        leaf.startExchange = required(
          counts[`start${String(index)}`] ?? null,
          'start exchange',
        );
        leaf.endExchange = required(
          counts[`end${String(index)}`] ?? null,
          'end exchange',
        );
      }
    }
    const latest = this.statements(
      `SELECT v.usage_json
       FROM message_positions p
       JOIN message_variants v ON v.id = p.selected_variant_id
       WHERE p.session_id = ? AND p.role = 'assistant' AND (v.source <> '' OR v.provider = 'authored')
       ORDER BY p.ordinal DESC LIMIT 1`,
    ).get(sessionId) as { usage_json: string } | undefined;
    const usages =
      latest === undefined
        ? []
        : usageSchema.nullable().array().parse(JSON.parse(latest.usage_json));
    const compactRange = this.#prospectiveCompactionRange(
      sessionId,
      liveTailExchanges,
    );
    return {
      leaves,
      exactFromExchange,
      currentExchange,
      lastRequestUsage: usages.at(-1) ?? null,
      lastSwipeCost:
        usages.length === 0
          ? null
          : usages.reduce<number | null>(
              (total, usage) =>
                total === null || usage === null
                  ? null
                  : total + usage.cost.total,
              0,
            ),
      canCompact: latest !== undefined && compactRange !== null,
      variables,
      todos: this.listTodos(sessionId),
      schedules,
    };
  }

  #prospectiveCompactionRange(
    sessionId: string,
    liveTailExchanges: number,
  ): {
    triggerPositionId: string;
    priorLeafId: string | null;
    startOrdinal: number;
    endOrdinal: number;
  } | null {
    if (this.#session(sessionId) === undefined)
      throw new StorageNotFoundError('Session not found');
    if (
      this.statements(
        `SELECT 1 FROM leaves WHERE session_id = ? AND state = 'pending'`,
      ).get(sessionId) !== undefined
    )
      return null;
    const prior = this.statements(
      `SELECT id, end_ordinal FROM leaves
       WHERE session_id = ? AND state = 'committed'
       ORDER BY start_ordinal DESC LIMIT 1`,
    ).get(sessionId) as { id: string; end_ordinal: number } | undefined;
    const startOrdinal = (prior?.end_ordinal ?? -1) + 1;
    const kept = this.statements(
      `SELECT id, ordinal FROM message_positions
       WHERE session_id = ? AND role = 'assistant' AND ordinal >= ?
       ORDER BY ordinal DESC LIMIT ?`,
    ).all(sessionId, startOrdinal, Math.max(1, liveTailExchanges)) as {
      id: string;
      ordinal: number;
    }[];
    const endOrdinal = (kept.at(-1)?.ordinal ?? -1) - 2;
    const covered = this.statements(
      `SELECT id FROM message_positions
       WHERE session_id = ? AND ordinal = ? AND role = 'assistant'`,
    ).get(sessionId, endOrdinal) as { id: string } | undefined;
    const triggerPositionId = covered?.id;
    return triggerPositionId === undefined || endOrdinal < startOrdinal
      ? null
      : {
          triggerPositionId,
          priorLeafId: prior?.id ?? null,
          startOrdinal,
          endOrdinal,
        };
  }

  editLeaf(input: {
    sessionId: string;
    leafId: string;
    summary: string;
    now: string;
  }): void {
    this.#database.transaction(() => {
      const result = this.statements(
        `UPDATE leaves SET summary = ?
         WHERE id = ? AND session_id = ? AND state = 'committed'`,
      ).run(input.summary, input.leafId, input.sessionId);
      if (result.changes === 0)
        throw new StorageNotFoundError('Committed leaf not found');
      publishLeaf(this.statements, input.leafId);
      this.#touch(input.sessionId, input.now);
    })();
  }

  variantSource(
    sessionId: string,
    variantId: string,
  ): {
    source: string;
    createdAt: string;
    presetSlug: string;
  } {
    const row = this.statements(
      `SELECT v.source, v.created_at, s.preset_slug
       FROM message_variants v
       JOIN message_positions p ON p.id = v.position_id
       JOIN sessions s ON s.id = p.session_id
       WHERE v.id = ? AND s.id = ?`,
    ).get(variantId, sessionId) as
      | {
          source: string;
          created_at: string;
          preset_slug: string;
        }
      | undefined;
    if (row === undefined) throw new StorageNotFoundError('Variant not found');
    return {
      source: row.source,
      createdAt: row.created_at,
      presetSlug: row.preset_slug,
    };
  }

  #acceptSelectedEffects(positionId: string): void {
    this.statements(
      `UPDATE effects SET state = 'accepted'
       WHERE position_id = ? AND state = 'candidate'
         AND variant_id = (
           SELECT selected_variant_id FROM message_positions WHERE id = ?
         )`,
    ).run(positionId, positionId);
  }

  #completeEffect(
    effectId: string,
    state: 'applied' | 'failed' | 'unresolved',
    result: string,
    now: string,
  ): void {
    this.statements(
      `UPDATE effects SET state = ?, result = ?, completed_at = ?
       WHERE id = ? AND state = 'accepted'`,
    ).run(state, result, now, effectId);
  }

  #listVariables(sessionId: string): SessionContext['variables'] {
    return this.statements(
      `SELECT name, value FROM session_variables WHERE session_id = ? ORDER BY name`,
    ).all(sessionId) as SessionContext['variables'];
  }

  #touch(sessionId: string, now: string): void {
    this.statements(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(
      now,
      sessionId,
    );
  }
}

function publishLeaf(prepare: Prepare, leafId: string): void {
  prepare(
    `INSERT INTO search_documents (handle, session_id, kind, ordinal, source)
       SELECT 'leaf:' || l.id, l.session_id, 'leaf', l.start_ordinal, l.summary
       FROM leaves l
       WHERE l.id = ? AND l.state = 'committed'
       ON CONFLICT(handle) DO UPDATE SET source = excluded.source`,
  ).run(leafId);
}
