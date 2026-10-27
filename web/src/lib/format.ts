const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const DAY_MS = 86_400_000;

/** Local 24-hour "HH:MM". */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return timeFormat.format(date);
}

/**
 * The engine owns the instant; the client owns how it reads. v0.8 carries no
 * configured display timezone, so the viewer's own zone is the only one this
 * client can honestly claim. Callers may still pin an explicit zone.
 */
function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Stable calendar-day identity in the viewer's (or a given) timezone. */
export function conversationDateKey(
  iso: string,
  timezone: string = localTimezone(),
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

/** "Friday, July 24, 2026" in the viewer's (or a given) timezone. */
export function formatConversationDate(
  iso: string,
  timezone: string = localTimezone(),
): string {
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
 * Today and yesterday are decided by comparing day keys rather than by
 * subtracting milliseconds, so the answer stays consistent with the grouping
 * key in every timezone, across DST shifts and across the year boundary.
 */
export function formatDayDivider(
  iso: string,
  timezone: string = localTimezone(),
  now: Date = new Date(),
): string {
  const key = conversationDateKey(iso, timezone);
  if (key === conversationDateKey(now.toISOString(), timezone)) return 'Today';
  const yesterday = new Date(now.getTime() - DAY_MS);
  if (key === conversationDateKey(yesterday.toISOString(), timezone))
    return 'Yesterday';
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
