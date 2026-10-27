import type { AttemptEvent, Trace } from './contracts.js';

/** The same ordered inspection evidence in the engine and its live client. */
export function updateTrace(trace: Trace, event: AttemptEvent): Trace {
  if (event.type === 'thinking_delta') {
    if (event.delta === '') return trace;
    const last = trace.at(-1);
    return last?.type === 'reasoning'
      ? [...trace.slice(0, -1), { ...last, text: last.text + event.delta }]
      : [...trace, { type: 'reasoning', text: event.delta }];
  }
  if (event.type === 'tool_call')
    return [
      ...trace,
      {
        type: 'tool',
        id: event.id,
        name: event.name,
        arguments: event.arguments,
        result: null,
        isError: false,
        startedAt: event.at,
        completedAt: null,
      },
    ];
  if (event.type === 'tool_result') {
    const index = trace.findLastIndex(
      (entry) => entry.type === 'tool' && entry.id === event.id,
    );
    if (index < 0) return trace;
    return trace.map((entry, ordinal) =>
      ordinal === index && entry.type === 'tool'
        ? {
            ...entry,
            result: event.result,
            isError: event.isError,
            completedAt: event.at,
          }
        : entry,
    );
  }
  return trace;
}
