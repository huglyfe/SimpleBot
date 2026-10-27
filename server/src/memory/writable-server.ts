import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { PRODUCT_SLUG } from '@simplebot/shared';

import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

import { VERSION } from '../root.js';

const itemSchema = z.object({
  bot: z.string(),
  session: z.string(),
  text: z.string(),
  at: z.string(),
});
type Item = z.infer<typeof itemSchema>;

const server = new McpServer({
  name: `${PRODUCT_SLUG}-writable-memory`,
  version: VERSION,
});

server.registerTool(
  'recall',
  {
    description: 'Recall bot-scoped retained exchanges.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      query: z.string(),
      bot: z.string(),
      session: z.string(),
      at: z.string().optional(),
    }),
  },
  async ({ query, bot }) => {
    const terms = query.toLowerCase().split(/\s+/u).filter(Boolean);
    const matches = (await load())
      .filter(
        (item) =>
          item.bot === bot &&
          terms.some((term) => item.text.toLowerCase().includes(term)),
      )
      .slice(-20)
      .map((item) => item.text);
    return { content: [{ type: 'text', text: matches.join('\n\n') }] };
  },
);

server.registerTool(
  'retain',
  {
    description: 'Retain one accepted conversation exchange.',
    annotations: { readOnlyHint: false },
    inputSchema: itemSchema,
  },
  async (item) => {
    const items = await load();
    items.push(item);
    await save(items);
    return { content: [{ type: 'text', text: 'retained' }] };
  },
);

async function load(): Promise<Item[]> {
  try {
    return z
      .array(itemSchema)
      .parse(JSON.parse(await readFile(path(), 'utf8')));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function save(items: Item[]): Promise<void> {
  const target = path();
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  await writeFile(temporary, JSON.stringify(items), { flag: 'w' });
  await rename(temporary, target);
}

function path(): string {
  const value = process.env.MEMORY_PATH;
  if (value === undefined) throw new Error('MEMORY_PATH is required');
  return value;
}

const handle = serveStdio(() => server);
process.on('SIGINT', () => void handle.close());
process.on('SIGTERM', () => void handle.close());
