import { z } from 'zod';

const entrySchema = z.object({
  keys: z.array(z.string().min(1)),
  content: z.string(),
});

const sillyTavernBookSchema = z.object({
  entries: z.record(
    z.string(),
    z.object({
      key: z.array(z.string()),
      content: z.string(),
      disable: z.boolean().optional(),
    }),
  ),
});

/** File-format translation only; the Memory server owns recall behavior. */
export function parseLorebook(value: unknown): z.infer<typeof entrySchema>[] {
  if (Array.isArray(value)) return z.array(entrySchema).parse(value);

  const book = sillyTavernBookSchema.parse(value);
  return Object.values(book.entries)
    .filter((entry) => entry.disable !== true)
    .map((entry) => ({
      keys: entry.key.filter((key) => key.trim().length > 0),
      content: entry.content,
    }));
}
