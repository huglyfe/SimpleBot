/**
 * Full-text history search and the one write-through that keeps it honest.
 *
 * The FTS rows are a projection: only a selected assistant variant is
 * published, so search agrees with what later context would actually read.
 * Nothing here owns a conversation fact, which is why it is not in `Storage`.
 */

import { z } from 'zod';

import { NO_RESPONSE } from '@simplebot/shared';

import { sessionDisplayTitleSql, type Prepare } from './storage-rows.js';

const historyMatchSchema = z.strictObject({
  kind: z.enum(['message', 'summary']),
  number: z.number().int().positive(),
  content: z.string(),
  snippet: z.string(),
});
const botHistoryMatchSchema = historyMatchSchema.extend({
  sessionTitle: z.string().min(1),
});
const sessionMatchSchema = z.strictObject({
  sessionId: z.string().min(1),
  snippet: z.string(),
});

export type HistoryMatch = z.infer<typeof historyMatchSchema>;
export type BotHistoryMatch = z.infer<typeof botHistoryMatchSchema>;
export type SessionMatch = z.infer<typeof sessionMatchSchema>;

/** Documents read per session asked for, bounding one crowded session's reach. */
const SESSION_MATCH_FANOUT = 10;

export function searchHistory(
  prepare: Prepare,
  sessionId: string,
  query: string,
  limit: number,
): HistoryMatch[] {
  const match = historyMatch(query);
  if (match.length === 0) return [];
  return prepare(
    `SELECT CASE d.kind WHEN 'leaf' THEN 'summary' ELSE 'message' END AS kind,
            d.ordinal + 1 AS number, d.source AS content,
            snippet(search_fts, 0, '[', ']', ' … ', 20) AS snippet
     FROM search_fts
     JOIN search_documents d ON d.rowid = search_fts.rowid
     WHERE search_fts MATCH ? AND d.session_id = ?
     ORDER BY bm25(search_fts), d.ordinal
     LIMIT ?`,
  )
    .all(match, sessionId, limit)
    .map((row: unknown) => historyMatchSchema.parse(row));
}

export function searchBotHistory(
  prepare: Prepare,
  botSlug: string,
  currentSessionId: string,
  query: string,
  limit: number,
): BotHistoryMatch[] {
  const match = historyMatch(query);
  if (match.length === 0) return [];
  return prepare(
    `SELECT CASE d.kind WHEN 'leaf' THEN 'summary' ELSE 'message' END AS kind,
            d.ordinal + 1 AS number, d.source AS content,
            snippet(search_fts, 0, '[', ']', ' … ', 20) AS snippet,
            ${sessionDisplayTitleSql('s')} AS sessionTitle
     FROM search_fts
     JOIN search_documents d ON d.rowid = search_fts.rowid
     JOIN sessions s ON s.id = d.session_id
     WHERE search_fts MATCH ? AND s.bot_slug = ? AND s.id <> ?
     ORDER BY bm25(search_fts), s.updated_at DESC, d.ordinal
     LIMIT ?`,
  )
    .all(match, botSlug, currentSessionId, limit)
    .map((row: unknown) => botHistoryMatchSchema.parse(row));
}

/**
 * Every session whose canonical text matches, best match first, one snippet
 * each. The operator owns every conversation in the root, so this crosses
 * sessions and bots freely: invariant 7 bounds what a bot may
 * read, not what the person running the installation may search.
 *
 * Ranked documents collapse to one row per session here rather than in SQL:
 * `snippet()` needs its own matched row, which a GROUP BY would take away.
 */
export function searchSessions(
  prepare: Prepare,
  query: string,
  limit: number,
): SessionMatch[] {
  const match = historyMatch(query);
  if (match.length === 0) return [];
  const rows = prepare(
    `SELECT d.session_id AS sessionId,
            snippet(search_fts, 0, '[', ']', ' … ', 12) AS snippet
     FROM search_fts
     JOIN search_documents d ON d.rowid = search_fts.rowid
     WHERE search_fts MATCH ?
     ORDER BY bm25(search_fts), d.session_id, d.ordinal
     LIMIT ?`,
  ).all(match, limit * SESSION_MATCH_FANOUT);
  const best = new Map<string, SessionMatch>();
  for (const row of rows) {
    const parsed = sessionMatchSchema.parse(row);
    if (best.has(parsed.sessionId)) continue;
    best.set(parsed.sessionId, parsed);
    if (best.size === limit) break;
  }
  return [...best.values()];
}

export function syncAssistantSearch(
  prepare: Prepare,
  positionId: string,
): void {
  const selected = prepare(
    `SELECT p.session_id, p.ordinal, v.source
     FROM message_positions p
     JOIN message_variants v ON v.id = p.selected_variant_id
     WHERE p.id = ? AND p.role = 'assistant'`,
  ).get(positionId) as
    { session_id: string; ordinal: number; source: string } | undefined;
  if (selected === undefined) return;
  if (selected.source.trim() === '' || selected.source === NO_RESPONSE) {
    prepare(`DELETE FROM search_documents WHERE handle = ?`).run(
      `position:${positionId}`,
    );
    return;
  }
  prepare(
    `INSERT INTO search_documents (handle, session_id, kind, ordinal, source)
     VALUES (?, ?, 'message', ?, ?)
     ON CONFLICT(handle) DO UPDATE SET source = excluded.source`,
  ).run(
    `position:${positionId}`,
    selected.session_id,
    selected.ordinal,
    selected.source,
  );
}

function historyMatch(query: string): string {
  return query
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(' AND ');
}
