import { describe, expect, it } from 'vitest';
import type {
  MessagePosition,
  SessionChange,
  SessionProjection,
} from '@simplebot/shared';

import {
  LOADED_POSITION_LIMIT,
  applyChange,
  collapseToLimit,
  fromProjection,
  mergeTail,
  prependPage,
} from './conversation.js';

function position(
  ordinal: number,
  source = `message ${String(ordinal)}`,
): MessagePosition {
  return {
    id: `position-${String(ordinal)}`,
    ordinal,
    role: 'user',
    source,
    attachments: [],
    createdAt: '2026-08-14T09:00:00.000Z',
  };
}

function projection(
  positions: MessagePosition[],
  options: { hasMore?: boolean; updatedAt?: string } = {},
): SessionProjection {
  return {
    id: 'session-1',
    botSlug: 'seraphina',
    presetSlug: 'default',
    createdAt: '2026-08-14T09:00:00.000Z',
    updatedAt: options.updatedAt ?? '2026-08-14T09:00:00.000Z',
    activeAttemptId: null,
    page: { positions, hasMore: options.hasMore ?? false },
  };
}

describe('conversation cache', () => {
  it('prepends older pages and keeps their hasMore answer', () => {
    const held = fromProjection(
      projection([position(4), position(5)], { hasMore: true }),
    );
    const next = prependPage(held, {
      positions: [position(2), position(3)],
      hasMore: false,
    });
    expect(next.positions.map((row) => row.ordinal)).toEqual([2, 3, 4, 5]);
    expect(next.hasMore).toBe(false);
  });

  it('merges a fresh tail without dropping loaded history', () => {
    const held = prependPage(
      fromProjection(projection([position(4), position(5)], { hasMore: true })),
      { positions: [position(2), position(3)], hasMore: false },
    );
    const merged = mergeTail(
      held,
      projection([position(4, 'edited'), position(5), position(6)], {
        hasMore: true,
        updatedAt: '2026-08-14T10:00:00.000Z',
      }),
    );
    expect(merged.positions.map((row) => row.ordinal)).toEqual([2, 3, 4, 5, 6]);
    expect(merged.positions[2]).toMatchObject({ source: 'edited' });
    expect(merged.hasMore).toBe(false);
    expect(merged.session.updatedAt).toBe('2026-08-14T10:00:00.000Z');
  });

  it('patches changed loaded rows without inserting out-of-page rows', () => {
    const current = fromProjection(projection([position(2), position(3)]));
    const change: SessionChange = {
      ...current.session,
      updatedAt: '2026-08-14T10:00:00.000Z',
      positions: [position(3, 'changed'), position(9)],
    };
    const next = applyChange(current, change);
    expect(next.positions).toEqual([position(2), position(3, 'changed')]);
    expect(next.session.updatedAt).toBe('2026-08-14T10:00:00.000Z');
  });

  it('reopens at the fresh tail when background turns leave a gap, then pages through all history', () => {
    const rows = Array.from({ length: 120 }, (_, index) => position(index));
    const held = fromProjection(projection(rows.slice(0, 10)));
    const reopened = mergeTail(
      held,
      projection(rows.slice(70), { hasMore: true }),
    );
    expect(reopened.positions).toEqual(rows.slice(70));
    expect(reopened.hasMore).toBe(true);
    const earlier = prependPage(reopened, {
      positions: rows.slice(20, 70),
      hasMore: true,
    });
    const all = prependPage(earlier, {
      positions: rows.slice(0, 20),
      hasMore: false,
    });
    expect(all.positions).toEqual(rows);
    expect(all.hasMore).toBe(false);
  });

  it('preserves cached history when the fresh tail starts immediately after it', () => {
    const held = fromProjection(projection([position(0), position(1)]));
    const merged = mergeTail(
      held,
      projection([position(2), position(3)], { hasMore: true }),
    );
    expect(merged.positions.map((row) => row.ordinal)).toEqual([0, 1, 2, 3]);
    expect(merged.hasMore).toBe(false);
  });

  it('trims only at the loaded limit and preserves identity otherwise', () => {
    const held = fromProjection(
      projection(
        Array.from({ length: LOADED_POSITION_LIMIT }, (_, index) =>
          position(index),
        ),
      ),
    );
    expect(collapseToLimit(held)).toBe(held);

    const oversized = fromProjection(
      projection(
        Array.from({ length: LOADED_POSITION_LIMIT + 10 }, (_, index) =>
          position(index),
        ),
      ),
    );
    const collapsed = collapseToLimit(oversized);
    expect(collapsed.positions).toHaveLength(LOADED_POSITION_LIMIT);
    expect(collapsed.positions[0]?.ordinal).toBe(10);
    expect(collapsed.hasMore).toBe(true);
  });
});
