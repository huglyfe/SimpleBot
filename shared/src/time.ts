import { z } from 'zod';

export const clockFormatSchema = z.enum(['12', '24']);
export type ClockFormat = z.infer<typeof clockFormatSchema>;

/** An instant rendered in the application's timezone and clock convention. */
export function formatClockTime(
  instant: Date,
  timezone: string,
  clockFormat: ClockFormat,
): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: clockFormat === '12' ? 'h12' : 'h23',
  }).format(instant);
}

/** Sortable civil time, at the same minute precision as a to-do deadline. */
export function localDateTime(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
