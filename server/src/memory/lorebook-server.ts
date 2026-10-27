import { readFile } from 'node:fs/promises';

import { PRODUCT_SLUG } from '@simplebot/shared';

import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

import { VERSION } from '../root.js';
import { parseLorebook } from './lorebook.js';

const server = new McpServer({
  name: `${PRODUCT_SLUG}-lorebook-memory`,
  version: VERSION,
});

server.registerTool(
  'recall',
  {
    description: 'Recall matching read-only lorebook entries.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      query: z.string(),
      bot: z.string(),
      session: z.string(),
      at: z.string().optional(),
    }),
  },
  async ({ query }) => {
    const entries = await load();
    const terms = query.toLowerCase().split(/\s+/u).filter(Boolean);
    const matches = entries
      .filter((entry) =>
        entry.keys.some((key) =>
          terms.some((term) => key.toLowerCase().includes(term)),
        ),
      )
      .slice(0, 20)
      .map((entry) => entry.content);
    return { content: [{ type: 'text', text: matches.join('\n\n') }] };
  },
);

async function load() {
  const path = process.env.LOREBOOK_PATH;
  if (path === undefined) throw new Error('LOREBOOK_PATH is required');
  return parseLorebook(JSON.parse(await readFile(path, 'utf8')));
}

const handle = serveStdio(() => server);
process.on('SIGINT', () => void handle.close());
process.on('SIGTERM', () => void handle.close());
