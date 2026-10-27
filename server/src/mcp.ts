import {
  Client,
  StreamableHTTPClientTransport,
  type Tool as McpTool,
} from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { resolve } from 'node:path';

import { PRODUCT_SLUG } from '@simplebot/shared';

import type { McpDefinition } from './authored.js';
import { resolveCredential } from './credentials.js';
import { VERSION } from './root.js';

const MCP_TIMEOUT_MS = 30_000;

export class McpToolError extends Error {}
export class McpCallUnresolvedError extends Error {}

export interface ExternalTool {
  name: string;
  server: string;
  classification: 'read' | 'stateful';
  definition: McpTool;
}

export interface McpStatus {
  name: string;
  available: boolean;
  error: string | null;
}

interface Connection {
  server: string;
  client: Client;
  tools: readonly ExternalTool[];
}

/** One fixed set of MCP connections opened during dependency activation. */
export class McpResources {
  readonly statuses: readonly McpStatus[];
  readonly tools: readonly ExternalTool[];
  readonly #connections: ReadonlyMap<string, Connection>;
  readonly #byName: ReadonlyMap<string, ExternalTool>;
  #closed = false;

  constructor(
    connections: readonly Connection[],
    statuses: readonly McpStatus[],
  ) {
    this.#connections = new Map(
      connections.map((connection) => [connection.server, connection]),
    );
    // Connection validation rejects normalized-name collisions before publication.
    this.tools = connections.flatMap((entry) => entry.tools);
    this.#byName = new Map(this.tools.map((tool) => [tool.name, tool]));
    this.statuses = statuses;
  }

  async call(
    name: string,
    arguments_: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<string> {
    const tool = this.#byName.get(name);
    if (tool === undefined) throw new Error(`Unavailable MCP tool: ${name}`);
    const connection = this.#connections.get(tool.server);
    if (connection === undefined || this.#closed) {
      throw new Error(`Unavailable MCP server: ${tool.server}`);
    }
    let result: Awaited<ReturnType<Client['callTool']>>;
    try {
      result = await connection.client.callTool(
        { name: tool.definition.name, arguments: arguments_ },
        {
          signal,
          timeout: MCP_TIMEOUT_MS,
          toolDefinition: tool.definition,
        },
      );
    } catch (error) {
      // Unknown outcome, so it becomes an `unresolved` effect and nothing
      // replays it. The connection stays open: one slow or rejected call says
      // nothing about the next.
      throw new McpCallUnresolvedError(
        error instanceof Error ? error.message : String(error),
        { cause: error },
      );
    }
    return renderResult(result);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await Promise.all(
      [...this.#connections.values()].map(async (connection) =>
        connection.client.close().catch(() => undefined),
      ),
    );
  }
}

export async function activateMcp(
  definitions: Readonly<Record<string, McpDefinition>>,
  root: string,
): Promise<McpResources> {
  const opened = await Promise.all(
    Object.entries(definitions).map(async ([name, definition]) => ({
      name,
      connection: await connect(name, definition, root),
    })),
  );
  const connections: Connection[] = [];
  const statuses: McpStatus[] = [];
  for (const { name, connection } of opened) {
    if (connection.value === null)
      statuses.push({ name, available: false, error: connection.error });
    else {
      connections.push(connection.value);
      statuses.push({ name, available: true, error: null });
    }
  }
  return new McpResources(connections, statuses);
}

/** Reports the transport's own failure, which is the one an operator can act on. */
async function connect(
  name: string,
  definition: McpDefinition,
  root: string,
): Promise<{ value: Connection | null; error: string | null }> {
  const client = new Client(
    { name: PRODUCT_SLUG, version: VERSION },
    {
      versionNegotiation: { mode: 'legacy' },
      listMaxPages: 8,
      inputRequired: { autoFulfill: false },
    },
  );
  try {
    await client.connect(transport(definition, root), {
      timeout: MCP_TIMEOUT_MS,
    });
    const result = await client.listTools(undefined, {
      timeout: MCP_TIMEOUT_MS,
    });
    const tools = result.tools.map((tool) => externalTool(name, tool));
    const names = new Set<string>();
    for (const tool of tools) {
      if (names.has(tool.name))
        throw new Error(
          `Duplicate MCP tool name after normalization: ${tool.name}`,
        );
      names.add(tool.name);
    }
    return {
      value: {
        server: name,
        client,
        tools,
      },
      error: null,
    };
  } catch (error) {
    await client.close().catch(() => undefined);
    return {
      value: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function mcpToolName(server: string, nativeName: string): string {
  return `mcp__${server}__${nativeName.replace(/[^A-Za-z0-9_-]/gu, '_')}`;
}

function externalTool(server: string, tool: McpTool): ExternalTool {
  return {
    name: mcpToolName(server, tool.name),
    server,
    classification:
      tool.annotations?.readOnlyHint === false ? 'stateful' : 'read',
    definition: tool,
  };
}

function transport(definition: McpDefinition, root: string) {
  if (definition.type === 'stdio') {
    return new StdioClientTransport({
      command: definition.command,
      args: definition.args,
      env: resolveRecord(definition.env, root),
      cwd: definition.cwd === undefined ? root : resolve(root, definition.cwd),
      stderr: 'pipe',
    });
  }
  return new StreamableHTTPClientTransport(new URL(definition.url), {
    requestInit: {
      headers: resolveRecord(definition.headers, root),
    },
    fetch: (input, init) => fetch(input, { ...init, redirect: 'manual' }),
    reconnectionOptions: {
      initialReconnectionDelay: 0,
      maxReconnectionDelay: 0,
      reconnectionDelayGrowFactor: 1,
      maxRetries: 0,
    },
    maxStepUpRetries: 0,
    onInsufficientScope: 'throw',
  });
}

function resolveRecord(
  source: Record<string, string>,
  root: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source).map(([name, value]) => [
      name,
      resolveCredential(value, 'MCP', process.env, root) ?? value,
    ]),
  );
}

function renderResult(result: Awaited<ReturnType<Client['callTool']>>): string {
  const rendered =
    result.structuredContent === undefined
      ? result.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n') || JSON.stringify(result.content)
      : JSON.stringify(result.structuredContent);
  if (result.isError) throw new McpToolError(rendered);
  return rendered;
}
