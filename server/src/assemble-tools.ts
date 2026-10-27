/**
 * Every tool one attempt may call, and the one place a tool's definition meets
 * its session-owned execution.
 *
 * The catalog publishes what a bot *may* select; this builds what this
 * attempt actually gets, in the order assembly presents them, filtered to the
 * bot's exact grants. A tool returns its result or an internal candidate effect.
 * MCP and terminal calls execute directly; internal writes wait for acceptance.
 */

import type { Tool } from '@earendil-works/pi-ai';
import { Type, type Static, type TObject, type TProperties } from 'typebox';
import { randomUUID } from 'node:crypto';
import {
  TODO_TITLE_MAX,
  TODO_NOTE_MAX,
  todoCreateSchema,
  todoUpdateSchema,
  type Todo,
  type StoredVariant,
} from '@simplebot/shared';

import { calculate } from './calculator.js';
import type {
  ActivatedCapabilities,
  SelectedCapabilities,
} from './capabilities.js';
import type { ExternalTool } from './mcp.js';
import {
  searchBotHistory,
  searchHistory,
  type BotHistoryMatch,
  type HistoryMatch,
  type Storage,
} from './storage.js';
import { formatElapsedDuration } from './prompt-macros.js';
import { filterVariables } from './variables.js';

export type AttemptEffect = Pick<
  StoredVariant['effects'][number],
  'type' | 'arguments'
>;

type AttemptToolExecution = string | AttemptEffect;

export interface AttemptTool extends Tool {
  execute: (
    arguments_: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<AttemptToolExecution>;
}

interface ToolContext {
  now: Date;
  timezone: string;
  previousUserMessageAt: string | null;
  variables: Readonly<Record<string, string>>;
  todos: readonly Todo[];
  storage: Storage;
  sessionId: string;
  botSlug: string;
  capabilities: SelectedCapabilities;
  resources: ActivatedCapabilities;
  terminalTimeoutMs: number;
  terminalMaxOutputChars: number;
  maxToolResultChars: number;
}

/**
 * One definition owns its argument schema, execution, and catalog visibility.
 * The model loop validates arguments against this schema before execution.
 */
function tool<
  const Name extends `system__${string}`,
  const Properties extends TProperties,
>(
  name: Name,
  description: string,
  properties: Properties,
  execute: (
    context: ToolContext,
    arguments_: Static<TObject<Properties>>,
    signal: AbortSignal,
  ) => Promise<AttemptToolExecution>,
  selectable = true,
) {
  return {
    name,
    description,
    parameters: Type.Object(properties),
    selectable,
    execute: execute as (
      context: ToolContext,
      arguments_: Record<string, unknown>,
      signal: AbortSignal,
    ) => Promise<AttemptToolExecution>,
  };
}

const HISTORY_SEARCH_LIMIT = 5;
const SESSION_LIST_LIMIT = 20;
const TOOL_SEARCH_LIMIT = 10;

export const SYSTEM_TOOL_DEFINITIONS = deepFreeze([
  tool(
    'system__calculator',
    'Calculate an expression.',
    { expression: Type.String({ minLength: 1, maxLength: 500 }) },
    async (_context, arguments_) => {
      return String(calculate(arguments_.expression));
    },
  ),
  tool(
    'system__wall_clock',
    'Get the current date and time.',
    {},
    async ({ now, timezone }) => {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        dateStyle: 'full',
        timeStyle: 'long',
      }).format(now);
    },
  ),
  tool(
    'system__idle_time',
    'Get time since the last user message.',
    {},
    async ({ now, previousUserMessageAt }) => {
      const elapsedSeconds =
        previousUserMessageAt === null
          ? 0
          : (now.getTime() - Date.parse(previousUserMessageAt)) / 1_000;
      return formatElapsedDuration(elapsedSeconds);
    },
  ),
  tool(
    'system__variable_list',
    'List session variables.',
    { pattern: Type.Optional(Type.String({ minLength: 1 })) },
    async ({ variables }, arguments_) => {
      return JSON.stringify(filterVariables(variables, arguments_.pattern));
    },
  ),
  tool(
    'system__variable_set',
    'Set a session variable.',
    {
      name: Type.String({ minLength: 1, maxLength: 100 }),
      value: Type.String({ maxLength: 8_000 }),
    },
    async (_context, arguments_) => {
      return {
        type: 'variable_set',
        arguments: structuredClone(arguments_),
      };
    },
  ),
  tool(
    'system__variable_delete',
    'Delete a session variable.',
    { name: Type.String({ minLength: 1, maxLength: 100 }) },
    async (_context, arguments_) => {
      return {
        type: 'variable_delete',
        arguments: structuredClone(arguments_),
      };
    },
  ),
  tool('system__todo_list', 'List session to-dos.', {}, async ({ todos }) =>
    JSON.stringify(todos),
  ),
  tool(
    'system__todo_add',
    'Add a session to-do.',
    {
      title: Type.String({ minLength: 1, maxLength: TODO_TITLE_MAX }),
      dueDate: Type.Optional(
        Type.Union([Type.String({ format: 'date' }), Type.Null()]),
      ),
      note: Type.Optional(Type.String({ maxLength: TODO_NOTE_MAX })),
    },
    async (_context, arguments_) => ({
      type: 'todo_add',
      arguments: { id: randomUUID(), ...todoCreateSchema.parse(arguments_) },
    }),
  ),
  tool(
    'system__todo_update',
    'Edit or close a session to-do.',
    {
      id: Type.String({ format: 'uuid' }),
      title: Type.Optional(
        Type.String({ minLength: 1, maxLength: TODO_TITLE_MAX }),
      ),
      dueDate: Type.Optional(
        Type.Union([Type.String({ format: 'date' }), Type.Null()]),
      ),
      note: Type.Optional(Type.String({ maxLength: TODO_NOTE_MAX })),
      status: Type.Optional(
        Type.Union(
          ['open', 'done', 'missed', 'dropped'].map((value) =>
            Type.Literal(value),
          ),
        ),
      ),
    },
    async (_context, arguments_) => ({
      type: 'todo_update',
      arguments: todoUpdateSchema.parse(arguments_),
    }),
  ),
  tool(
    'system__schedule_set',
    'Create or update a schedule.',
    {
      id: Type.Optional(Type.String({ format: 'uuid' })),
      name: Type.String({ minLength: 1, maxLength: 120 }),
      expression: Type.String({ minLength: 1, maxLength: 200 }),
      prompt: Type.String({ minLength: 1, maxLength: 20_000 }),
      enabled: Type.Optional(Type.Boolean({ default: true })),
    },
    async (_context, arguments_) => {
      return {
        type: 'schedule_set',
        arguments: structuredClone(arguments_),
      };
    },
  ),
  tool(
    'system__schedule_delete',
    'Delete a schedule.',
    { id: Type.String({ format: 'uuid' }) },
    async (_context, arguments_) => {
      return {
        type: 'schedule_delete',
        arguments: structuredClone(arguments_),
      };
    },
  ),
  tool(
    'system__history_search',
    'Search this conversation.',
    {
      query: Type.String({ minLength: 1, maxLength: 500 }),
      limit: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 10,
          default: HISTORY_SEARCH_LIMIT,
        }),
      ),
    },
    async ({ storage, sessionId }, arguments_) => {
      return formatHistoryMatches(
        searchHistory(
          storage.statements,
          sessionId,
          arguments_.query,
          arguments_.limit ?? HISTORY_SEARCH_LIMIT,
        ),
      );
    },
  ),
  tool(
    'system__bot_session_list',
    'List this bot’s conversations.',
    {
      limit: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 50, default: SESSION_LIST_LIMIT }),
      ),
    },
    async ({ storage, sessionId, botSlug }, arguments_) => {
      const limit = arguments_.limit ?? SESSION_LIST_LIMIT;
      const titles = storage
        .listSessions(botSlug, limit + 1)
        .filter((session) => session.id !== sessionId)
        .slice(0, limit)
        .map((session) => session.title);
      return titles.length === 0 ? 'No conversations.' : titles.join('\n');
    },
  ),
  tool(
    'system__bot_history_search',
    'Search this bot’s conversations.',
    {
      query: Type.String({ minLength: 1, maxLength: 500 }),
      limit: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 10,
          default: HISTORY_SEARCH_LIMIT,
        }),
      ),
    },
    async ({ storage, sessionId, botSlug }, arguments_) => {
      return formatHistoryMatches(
        searchBotHistory(
          storage.statements,
          botSlug,
          sessionId,
          arguments_.query,
          arguments_.limit ?? HISTORY_SEARCH_LIMIT,
        ),
      );
    },
  ),
  tool(
    'system__skill_read',
    'Read a granted Skill.',
    { name: Type.String({ minLength: 1, maxLength: 256 }) },
    async ({ capabilities }, arguments_) => {
      const skill = capabilities.skills.find(
        (skill) => skill.name === arguments_.name,
      );
      if (skill === undefined) return 'Skill not granted';
      return skill.source;
    },
    false,
  ),
  tool(
    'system__tool_search',
    'Find granted external tools and their input schemas. Call a result through system__tool_call, copying its name exactly; result names are not directly callable functions.',
    {
      query: Type.String({ minLength: 1, maxLength: 200 }),
      limit: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 20, default: TOOL_SEARCH_LIMIT }),
      ),
    },
    async ({ capabilities }, arguments_) => {
      return JSON.stringify(
        searchExternalTools(
          capabilities.externalTools,
          arguments_.query,
          arguments_.limit ?? TOOL_SEARCH_LIMIT,
        ).map(({ name, definition, classification }) => ({
          name,
          description: definition.description ?? '',
          inputSchema: definition.inputSchema,
          classification,
        })),
      );
    },
    false,
  ),
  tool(
    'system__tool_call',
    'Call a granted external tool. Use system__tool_search first when its exact name or input schema is unknown.',
    {
      name: Type.String({
        minLength: 1,
        maxLength: 512,
        description:
          'Copy the exact name from a search result, preserving underscores, hyphens, and case. This is a string identifier, not code.',
      }),
      arguments: Type.Record(Type.String(), Type.Unknown(), {
        description:
          'A JSON object matching the selected tool’s inputSchema. Pass the object directly, not a JSON string or another call wrapper.',
      }),
    },
    async ({ resources, capabilities }, arguments_, signal) => {
      const { name, arguments: callArguments } = arguments_;
      const tool = capabilities.externalTools.find(
        (tool) => tool.name === name,
      );
      if (tool === undefined) return 'Tool not granted';
      return resources.call(name, callArguments, signal);
    },
    false,
  ),
  tool(
    'system__terminal',
    'Run a Docker command.',
    { command: Type.String({ minLength: 1, maxLength: 20_000 }) },
    async (
      {
        resources,
        capabilities,
        terminalTimeoutMs: timeoutMs,
        terminalMaxOutputChars: maxOutputChars,
      },
      arguments_,
      signal,
    ) => {
      const { command } = arguments_;
      const dependency = capabilities.terminal;
      if (dependency === null) throw new Error('Terminal not granted');
      return resources.runTerminal(
        dependency,
        command,
        { timeoutMs, maxOutputChars },
        signal,
      );
    },
    false,
  ),
] as const);

export function buildAttemptTools(input: ToolContext): readonly AttemptTool[] {
  return Object.freeze([
    ...SYSTEM_TOOL_DEFINITIONS.filter((tool) =>
      input.capabilities.toolNames.includes(tool.name),
    ).map(({ selectable: _selectable, execute, ...definition }) =>
      Object.freeze({
        ...definition,
        execute: (arguments_: Record<string, unknown>, signal: AbortSignal) =>
          execute(input, arguments_, signal),
      }),
    ),
    ...input.resources
      .fileTools()
      .filter((tool) => input.capabilities.toolNames.includes(tool.name))
      .map(({ name, description, parameters }) =>
        deepFreeze({
          name,
          description,
          parameters,
          execute: (args: Record<string, unknown>, signal: AbortSignal) =>
            input.resources.callFile(
              name,
              args,
              {
                timeoutMs: input.terminalTimeoutMs,
                maxOutputChars: Math.min(
                  input.terminalMaxOutputChars,
                  input.maxToolResultChars,
                ),
              },
              signal,
            ),
        }),
      ),
  ]);
}

/** Frozen so a tool definition cannot be mutated by the loop that runs it. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function searchTerms(value: string): string[] {
  return [
    ...new Set(
      value
        .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9]+/gu)
        .filter((term) => term.length > 0),
    ),
  ];
}

/** Exact names win; otherwise rank flat token overlap over useful fields. */
export function searchExternalTools(
  tools: readonly ExternalTool[],
  query: string,
  limit: number,
): readonly ExternalTool[] {
  if (limit <= 0) return [];
  const exact = query.trim().toLowerCase();
  const terms = searchTerms(query);
  return tools
    .map((tool) => {
      const name = tool.name.toLowerCase();
      const properties = tool.definition.inputSchema.properties;
      const searchable = new Set(
        searchTerms(
          [
            tool.name,
            tool.definition.description ?? '',
            Object.keys(properties ?? {}).join(' '),
          ].join(' '),
        ),
      );
      const score =
        name === exact
          ? terms.length + 1
          : terms.filter((term) => searchable.has(term)).length;
      return { tool, score };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.tool.name.localeCompare(right.tool.name),
    )
    .slice(0, limit)
    .map(({ tool }) => tool);
}

function formatHistoryMatches(
  matches: readonly (HistoryMatch | BotHistoryMatch)[],
): string {
  if (matches.length === 0) return 'No matches.';
  return matches
    .map((match) => {
      const session =
        'sessionTitle' in match
          ? `Conversation: ${JSON.stringify(match.sessionTitle)}\n`
          : '';
      const location =
        match.kind === 'message'
          ? `Message ${String(match.number)}`
          : `Summary at message ${String(match.number)}`;
      const content =
        match.content.length <= 800
          ? match.content
          : `${match.content.slice(0, 786)}… [truncated]`;
      return `${session}${location}\n${content}`;
    })
    .join('\n\n');
}
