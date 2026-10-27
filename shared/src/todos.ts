import { z } from 'zod';

// Like variables, current to-dos have fixed bounds and no archive.
export const MAX_TODOS = 32;
export const TODO_TITLE_MAX = 200;
export const TODO_NOTE_MAX = 2_000;

const fields = {
  title: z.string().trim().min(1).max(TODO_TITLE_MAX),
  dueDate: z.iso.date().nullable(),
  note: z.string().max(TODO_NOTE_MAX),
};

export const todoCreateSchema = z.strictObject({
  ...fields,
  dueDate: fields.dueDate.default(null),
  note: fields.note.default(''),
});
export const todoSchema = z.strictObject({ id: z.uuid(), ...fields });
export const todoUpdateSchema = z
  .strictObject({
    id: z.uuid(),
    title: fields.title.optional(),
    dueDate: fields.dueDate.optional(),
    note: fields.note.optional(),
    status: z.enum(['open', 'done', 'missed', 'dropped']).optional(),
  })
  .refine((value) => Object.keys(value).length > 1, 'Supply a change');

export type Todo = z.infer<typeof todoSchema>;
export type TodoCreate = z.infer<typeof todoCreateSchema>;
export type TodoUpdate = z.infer<typeof todoUpdateSchema>;

/** Calendar days in the one application timezone, including across DST. */
export function formatTodoDue(
  dueDate: string | null,
  timezone: string,
  now: Date,
): string {
  if (dueDate === null) return 'No due date';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((value) => value.type === type)?.value);
  const today = new Date(0);
  today.setUTCFullYear(part('year'), part('month') - 1, part('day'));
  const days = Math.round((Date.parse(dueDate) - today.getTime()) / 86_400_000);
  const relative =
    days === 0
      ? 'due today'
      : days === 1
        ? 'due tomorrow'
        : days > 0
          ? `due in ${String(days)} days`
          : `${String(-days)} ${days === -1 ? 'day' : 'days'} overdue`;
  return `${dueDate} (${relative})`;
}
