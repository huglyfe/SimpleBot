/**
 * The client's view of one conversation: session-wide state, plus however much
 * transcript the operator has actually asked for.
 *
 * The transcript is the only part that grows without bound, so it is the only
 * part that arrives in pages. Everything else rides every response because it
 * is small and always current.
 */
import type {
  MessagePosition,
  SessionChange,
  SessionProjection,
  TranscriptPage,
} from '@simplebot/shared';

/**
 * The most transcript the client keeps loaded — three server pages. Reached
 * only by paging backwards or by a very long sitting; `collapseToLimit` trims
 * back to it at the live edge, where nothing dropped is on screen.
 */
export const LOADED_POSITION_LIMIT = 150;

export interface ConversationState {
  session: Omit<SessionProjection, 'page' | 'activeAttemptId'>;
  activeAttemptId: SessionProjection['activeAttemptId'];
  /** Loaded positions in reading order; may start mid-conversation. */
  positions: MessagePosition[];
  /** Older positions exist before `positions[0]`. */
  hasMore: boolean;
}

export function fromProjection(
  projection: SessionProjection,
): ConversationState {
  const { page, activeAttemptId, ...session } = projection;
  return {
    session,
    activeAttemptId,
    positions: page.positions,
    hasMore: page.hasMore,
  };
}

/** Prepends an older page. Its rows are strictly before what is held. */
export function prependPage(
  current: ConversationState,
  page: TranscriptPage,
): ConversationState {
  return {
    ...current,
    positions: [...page.positions, ...current.positions],
    hasMore: page.hasMore,
  };
}

/**
 * Trims the loaded transcript back to `LOADED_POSITION_LIMIT`, oldest first.
 *
 * Called on reaching the live edge, which is the one moment where this is
 * invisible: everything it drops is far above the viewport, and scrolling back
 * up fetches it again from the one authority that has it. That is what keeps a
 * long dig through history from being paid for until the session is reloaded,
 * without windowing the rendered rows or estimating a single height.
 *
 * Returns the same state when nothing is over the limit, so the caller can run
 * it on every arrival at the live edge without churning the cache.
 */
export function collapseToLimit(current: ConversationState): ConversationState {
  if (current.positions.length <= LOADED_POSITION_LIMIT) return current;
  const kept = current.positions.slice(-LOADED_POSITION_LIMIT);
  return {
    ...current,
    positions: kept,
    // Rows were dropped, so older ones exist by construction.
    hasMore: true,
  };
}

/**
 * Folds a fresh projection into held state after an attempt completes. The
 * projection's page is the authoritative newest slice — it carries the new
 * positions. Keep loaded history only when it meets that slice; after a long
 * absence, start at the fresh tail so paging can reach the intervening rows.
 */
export function mergeTail(
  current: ConversationState,
  projection: SessionProjection,
): ConversationState {
  const next = fromProjection(projection);
  const first = next.positions[0];
  if (first === undefined) return next;
  const older = current.positions.filter(
    (position) => position.ordinal < first.ordinal,
  );
  if (older.at(-1)?.ordinal !== first.ordinal - 1) return next;
  return {
    session: next.session,
    activeAttemptId: next.activeAttemptId,
    positions: [...older, ...next.positions],
    // Older pages are loaded, so whether more exist is still their answer.
    hasMore: current.hasMore,
  };
}

/**
 * Folds a mutation's answer in: session state wholesale, changed rows by ID.
 *
 * Rows outside the loaded pages are dropped rather than inserted, because a
 * page is a contiguous slice and a stray row would punch a hole in it.
 */
export function applyChange(
  current: ConversationState,
  change: SessionChange,
): ConversationState {
  const { positions, ...session } = change;
  return {
    session,
    activeAttemptId: current.activeAttemptId,
    positions: replaceById(current.positions, positions),
    hasMore: current.hasMore,
  };
}

function replaceById<T extends { id: string }>(
  current: T[],
  changed: readonly T[],
): T[] {
  if (changed.length === 0) return current;
  const byId = new Map(changed.map((row) => [row.id, row]));
  return current.map((row) => byId.get(row.id) ?? row);
}
