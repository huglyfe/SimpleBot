import { appendFile } from 'node:fs/promises';

import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const server = new McpServer(
  { name: 'simplebot-test-mcp', version: '1.0.0' },
  { capabilities: { tools: { listChanged: true } } },
);

for (const name of process.env.FIXTURE_TOOL_NAMES?.split(',') ?? []) {
  server.registerTool(
    name,
    { inputSchema: z.object({ city: z.string() }) },
    async ({ city }) => ({
      content: [{ type: 'text', text: `${name}: ${city}` }],
    }),
  );
}

server.registerTool(
  'weather',
  {
    description: 'Read the current test weather.',
    inputSchema: z.object({ city: z.string() }),
  },
  async ({ city }) => ({
    content: [{ type: 'text', text: `${city}: sunny` }],
  }),
);

if (process.env.DISABLE_RECALL !== '1')
  server.registerTool(
    'recall',
    {
      description: 'Recall test memory.',
      annotations: { readOnlyHint: true },
      inputSchema: z.object({ query: z.string() }),
    },
    async ({ query }) => ({
      content: [{ type: 'text', text: `Remembered ${query}` }],
    }),
  );

server.registerTool(
  'retain',
  {
    description: 'Retain test memory.',
    annotations: { readOnlyHint: false },
    inputSchema: z.object({ text: z.string() }),
  },
  async () => ({ content: [{ type: 'text', text: 'retained' }] }),
);

server.registerTool(
  'write_note',
  {
    description: 'Append a test note.',
    annotations: { readOnlyHint: false },
    inputSchema: z.object({
      text: z.string(),
      delayMs: z.number().int().nonnegative().optional(),
    }),
  },
  async ({ text, delayMs = 0 }) => {
    const path = process.env.FIXTURE_PATH;
    if (path === undefined) throw new Error('FIXTURE_PATH is required');
    if (delayMs > 0) {
      await appendFile(`${path}.started`, 'started\n');
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    await appendFile(path, `${text}\n`);
    return { content: [{ type: 'text', text: 'written' }] };
  },
);

server.registerTool(
  'fail',
  {
    description: 'Return one test tool error.',
    annotations: { readOnlyHint: true },
  },
  async () => {
    const path = process.env.FIXTURE_PATH;
    if (path === undefined) throw new Error('FIXTURE_PATH is required');
    await appendFile(`${path}.calls`, 'called\n');
    return {
      isError: true,
      content: [{ type: 'text', text: 'fixture failure' }],
    };
  },
);

const extra = server.registerTool(
  'extra',
  {
    description: 'A dynamically advertised tool.',
    annotations: { readOnlyHint: true },
  },
  async () => ({ content: [{ type: 'text', text: 'extra' }] }),
);
extra.disable();

server.registerTool(
  'enable_extra',
  {
    description: 'Enable the dynamic fixture tool.',
    annotations: { readOnlyHint: true },
  },
  async () => {
    extra.enable();
    return { content: [{ type: 'text', text: 'enabled' }] };
  },
);

const handle = serveStdio(() => server);
process.on('SIGINT', () => void handle.close());
process.on('SIGTERM', () => void handle.close());
