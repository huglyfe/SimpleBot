import { createContext, useContext } from 'react';
import {
  formatClockTime,
  localDateTime,
  type Bootstrap,
} from '@simplebot/shared';

export const TimePreferences = createContext<Bootstrap['time']>({
  timezone: 'UTC',
  clockFormat: '24',
});
export const useTimePreferences = () => useContext(TimePreferences);

const DAY_MS = 86_400_000;

export function formatTime(
  iso: string,
  preferences: Bootstrap['time'],
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return formatClockTime(date, preferences.timezone, preferences.clockFormat);
}

/** Stable calendar-day identity in the application timezone. */
export function conversationDateKey(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return localDateTime(date, timezone).slice(0, 10);
}

/** "Friday, July 24, 2026" in the application timezone. */
export function formatConversationDate(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

/**
 * Day-divider label: "Today", "Yesterday", or "Friday, July 24, 2026".
 *
 * Compare calendar dates, not elapsed 24-hour periods: DST days can have
 * 23 or 25 hours. The date keys use the same timezone as transcript grouping.
 */
export function formatDayDivider(
  iso: string,
  timezone: string,
  now: Date = new Date(),
): string {
  const key = conversationDateKey(iso, timezone);
  const today = conversationDateKey(now.toISOString(), timezone);
  const days = (Date.parse(today) - Date.parse(key)) / DAY_MS;
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return formatConversationDate(iso, timezone);
}

/** "3.2s" under a minute, otherwise "1m 12s". */
export function formatDuration(ms: number): string {
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60)
    return `${String(Math.floor(totalSeconds * 10) / 10)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${String(minutes)}m ${String(seconds)}s`;
}

/** Drawer recency: "now", "5m", "3h", "6d", then a short date. */
export function formatRelative(
  iso: string,
  timezone: string,
  now: Date = new Date(),
): string {
  const minutes = Math.floor((now.getTime() - Date.parse(iso)) / 60_000);
  if (Number.isNaN(minutes)) return '';
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${String(minutes)}m`;
  if (minutes < 1440) return `${String(Math.floor(minutes / 60))}h`;
  if (minutes < 10_080) return `${String(Math.floor(minutes / 1440))}d`;
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso));
}
