import { describe, expect, it } from 'vitest';

import {
  conversationDateKey,
  formatConversationDate,
  formatDayDivider,
  formatRelative,
} from './format.js';

describe('conversation dates', () => {
  it('groups by calendar day in the given timezone across a UTC date boundary', () => {
    const instant = '2026-07-25T02:30:00.000Z';

    expect(conversationDateKey(instant, 'America/New_York')).toBe('2026-07-24');
    expect(formatConversationDate(instant, 'America/New_York')).toContain(
      'July 24, 2026',
    );
    expect(conversationDateKey(instant, 'UTC')).toBe('2026-07-25');
  });
});

describe('formatDayDivider', () => {
  const now = new Date('2026-07-25T12:00:00.000Z');

  it('names today and yesterday relative to the viewer', () => {
    expect(formatDayDivider('2026-07-25T08:00:00.000Z', 'UTC', now)).toBe(
      'Today',
    );
    expect(formatDayDivider('2026-07-24T23:59:00.000Z', 'UTC', now)).toBe(
      'Yesterday',
    );
  });

  it('falls back to the full date beyond yesterday', () => {
    expect(formatDayDivider('2026-07-20T08:00:00.000Z', 'UTC', now)).toContain(
      'July 20, 2026',
    );
  });

  /**
   * Comparing day keys rather than subtracting milliseconds is what makes
   * this hold: in New York the same instant is still yesterday evening.
   */
  it('decides today and yesterday in the same timezone it groups by', () => {
    const instant = '2026-07-25T02:30:00.000Z';

    expect(formatDayDivider(instant, 'UTC', now)).toBe('Today');
    expect(formatDayDivider(instant, 'America/New_York', now)).toBe(
      'Yesterday',
    );
  });

  it('crosses a year boundary without arithmetic drift', () => {
    const newYear = new Date('2027-01-01T12:00:00.000Z');

    expect(formatDayDivider('2026-12-31T20:00:00.000Z', 'UTC', newYear)).toBe(
      'Yesterday',
    );
  });
});

it('uses the previous calendar day even when the DST day is shorter or longer', () => {
  expect(
    formatDayDivider(
      '2026-03-08T16:00:00Z',
      'America/New_York',
      new Date('2026-03-09T04:30:00Z'),
    ),
  ).toBe('Yesterday');
  expect(
    formatDayDivider(
      '2026-10-31T16:00:00Z',
      'America/New_York',
      new Date('2026-11-02T04:30:00Z'),
    ),
  ).toBe('Yesterday');
});

describe('drawer labels', () => {
  const now = new Date('2026-07-25T12:00:00.000Z');

  it('shortens recency and falls back to a date after a week', () => {
    expect(formatRelative('2026-07-25T11:59:40.000Z', 'UTC', now)).toBe('now');
    expect(formatRelative('2026-07-25T11:15:00.000Z', 'UTC', now)).toBe('45m');
    expect(formatRelative('2026-07-25T02:00:00.000Z', 'UTC', now)).toBe('10h');
    expect(formatRelative('2026-07-20T12:00:00.000Z', 'UTC', now)).toBe('5d');
    expect(formatRelative('2026-07-01T12:00:00.000Z', 'UTC', now)).toMatch(
      /Jul/u,
    );
  });
});
