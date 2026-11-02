import { z } from 'zod';
import { formatClockTime, localDateTime, type ClockFormat } from './time.js';

// Like variables, current to-dos have fixed bounds and no archive.
export const MAX_TODOS = 32;
export const TODO_TITLE_MAX = 200;
export const TODO_NOTE_MAX = 2_000;

const fields = {
  title: z.string().trim().min(1).max(TODO_TITLE_MAX),
  due: z.iso
    .datetime({ local: true, precision: -1 })
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u)
    .nullable(),
  note: z.string().max(TODO_NOTE_MAX),
};

export const todoCreateSchema = z.strictObject({
  ...fields,
  due: fields.due.default(null),
  note: fields.note.default(''),
});
export const todoSchema = z.strictObject({ id: z.uuid(), ...fields });
export const todoUpdateSchema = z
  .strictObject({
    id: z.uuid(),
    title: fields.title.optional(),
    due: fields.due.optional(),
    note: fields.note.optional(),
    status: z.enum(['open', 'done', 'missed', 'dropped']).optional(),
  })
  .refine((value) => Object.keys(value).length > 1, 'Supply a change');

export type Todo = z.infer<typeof todoSchema>;
export type TodoCreate = z.infer<typeof todoCreateSchema>;
export type TodoUpdate = z.infer<typeof todoUpdateSchema>;

/** Deadlines are civil times in the application timezone, never UTC instants. */
export function formatTodoDue(
  due: string | null,
  timezone: string,
  now: Date,
  clockFormat: ClockFormat = '24',
): string {
  if (due === null) return 'No deadline';
  const localNow = localDateTime(now, timezone);
  const date = due.slice(0, 10);
  const days = Math.round(
    (Date.parse(date) - Date.parse(localNow.slice(0, 10))) / 86_400_000,
  );
  const relative =
    due < localNow
      ? days < 0
        ? `${String(-days)} ${days === -1 ? 'day' : 'days'} overdue`
        : 'overdue'
      : days === 0
        ? 'due today'
        : days === 1
          ? 'due tomorrow'
          : `due in ${String(days)} days`;
  // UTC here formats the authored clock fields without shifting them.
  return `${date} ${formatClockTime(new Date(`${due}Z`), 'UTC', clockFormat)} (${relative})`;
}
