import {
  formatTodoDue,
  type Card,
  type Preset,
  type Todo,
} from '@simplebot/shared';

export type PromptExpander = (source: string) => string;

export function formatElapsedDuration(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  if (wholeSeconds < 60) return `${String(wholeSeconds)}s`;
  const minutes = Math.floor(wholeSeconds / 60);
  if (minutes < 60) return `${String(minutes)}m ${String(wholeSeconds % 60)}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ${String(minutes % 60)}m`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d ${String(hours % 24)}h`;
}

/** One deterministic macro snapshot shared by chat and summarization. */
export function createPromptExpander(input: {
  card: Card;
  persona: Preset['persona'];
  model: string;
  now: Date;
  timezone: string;
  previousUserMessageAt: string | null;
  variables: Readonly<Record<string, string>>;
  todos: readonly Todo[];
}): PromptExpander {
  const variables = new Map(Object.entries(input.variables));
  const idleDuration = formatIdleDuration(input);
  const values: Readonly<Record<string, string>> = {
    char: input.card.name,
    user: input.persona.name,
    persona: input.persona.description,
    description: input.card.description,
    personality: input.card.personality,
    scenario: input.card.scenario,
    mesexamplesraw: input.card.mes_example,
    model: input.model,
    date: new Intl.DateTimeFormat('en-US', {
      dateStyle: 'long',
      timeZone: input.timezone,
    }).format(input.now),
    time: new Intl.DateTimeFormat('en-US', {
      timeStyle: 'short',
      timeZone: input.timezone,
    }).format(input.now),
    weekday: new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      timeZone: input.timezone,
    }).format(input.now),
    idleduration: idleDuration,
    idle_duration: idleDuration,
    isotime: input.now.toISOString().slice(11, 19),
    isodate: input.now.toISOString().slice(0, 10),
    todos:
      input.todos.length === 0
        ? 'No open to-dos.'
        : input.todos
            .map(
              (todo) =>
                `${todo.id} — ${todo.title}\n${formatTodoDue(todo.due, input.timezone, input.now)}${todo.note === '' ? '' : `\n${todo.note}`}`,
            )
            .join('\n\n'),
    listvars: [...variables]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([name, value]) => `${name}: ${value}`)
      .join('\n'),
  };

  return (source) =>
    source.replace(
      /<(?:char|bot|user)>|\{\{\s*(?:(getvar(?:::|\s+)|hasvar::)([^}]+)|([a-z_]+))\s*\}\}/giu,
      (
        match,
        operation: string | undefined,
        argument: string | undefined,
        macro: string | undefined,
      ) => {
        if (argument !== undefined) {
          const name = argument.trim();
          return operation?.toLowerCase() === 'hasvar::'
            ? String(variables.has(name))
            : (variables.get(name) ?? '');
        }
        if (macro !== undefined) {
          const value = values[macro.toLowerCase()];
          return typeof value === 'string' ? value : match;
        }
        return match.toLowerCase() === '<user>'
          ? input.persona.name
          : input.card.name;
      },
    );
}

function formatIdleDuration(input: {
  now: Date;
  previousUserMessageAt: string | null;
}): string {
  if (input.previousUserMessageAt === null) return formatElapsedDuration(0);
  return formatElapsedDuration(
    (input.now.getTime() - Date.parse(input.previousUserMessageAt)) / 1_000,
  );
}
