/**
 * The engine's markup vocabulary: the trailing `system_error` region, the
 * stored `scheduled_event` occurrence, the `no_response` sentinel, and the one
 * escape pair they share.
 *
 * These tags are presentation syntax, not a second authority and not a general
 * XML document model. They cross the server/client boundary as stored source,
 * so the writer and the reader have to agree exactly. That agreement is the
 * reason they live here instead of beside whichever surface first needed one:
 * a tag written by the engine and read by a regex in a component is an
 * invariant stated twice, and the second statement drifts.
 */

/** The sentinel a variant stores when the bot deliberately said nothing. */
export const NO_RESPONSE = '<no_response />';

/** What startup stores for a response whose text the crash took with it. */
export const INTERRUPTED_ERROR =
  'Generation interrupted by application restart.';

/** An error detail longer than this is the provider being noisy, not useful. */
const MAX_ERROR_DETAIL = 2_000;

const SYSTEM_ERROR = /(?:\n)?<system_error>([\s\S]*)<\/system_error>\s*$/u;

const SCHEDULED_EVENT =
  /^<scheduled_event name="(?<name>[^"]*)" ran_at="(?<ranAt>[^"]*)">\n(?<prompt>[\s\S]*)\n<\/scheduled_event>$/u;

/** Text-position escape: the three characters that could otherwise open a tag. */
export function escapeText(source: string): string {
  return source
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** Attribute escape: adds the quote that would otherwise close the attribute. */
function escapeAttribute(source: string): string {
  return source
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;');
}

/** Inverse of both escapes, in the same order they have to be undone. */
function unescapeMarkup(source: string): string {
  return source
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&');
}

/**
 * Appends the one trailing error region to whatever the bot already
 * said. Accumulated text keeps its original order: the tag is never prepended,
 * so partial output still reads forwards.
 */
export function appendSystemError(source: string, message: string): string {
  const detail = message.trim() || 'Generation failed.';
  const escaped = escapeText(detail.slice(0, MAX_ERROR_DETAIL));
  return `${source}${source.length === 0 ? '' : '\n'}<system_error>${escaped}</system_error>`;
}

/** Whether a stored response ends in the error region. */
export function hasSystemError(source: string): boolean {
  return SYSTEM_ERROR.test(source);
}

/** Splits a stored response into bot text and its trailing error, if any. */
export function splitSystemError(source: string): {
  content: string;
  error: string | null;
} {
  const match = SYSTEM_ERROR.exec(source);
  if (match === null) return { content: source, error: null };
  return {
    content: source.slice(0, match.index),
    error: unescapeMarkup(match[1] ?? ''),
  };
}

/**
 * The exact user-position source one scheduled occurrence stores. Storing the
 * element the model actually answered is what lets a later swipe replay the
 * same turn instead of a bare marker.
 */
export function scheduledEventSource(input: {
  name: string;
  ranAt: string;
  prompt: string;
}): string {
  return [
    `<scheduled_event name="${escapeAttribute(input.name)}" ran_at="${input.ranAt}">`,
    escapeText(input.prompt),
    '</scheduled_event>',
  ].join('\n');
}

/**
 * Reads an occurrence back out of its stored source. That element is storage,
 * not conversation, so a client renders the authored prompt as prose under the
 * schedule's own name rather than showing the operator raw markup.
 */
export function parseScheduledEvent(
  source: string,
): { name: string; ranAt: string; prompt: string } | null {
  const match = SCHEDULED_EVENT.exec(source);
  if (match?.groups === undefined) return null;
  const { name, ranAt, prompt } = match.groups;
  if (name === undefined || ranAt === undefined || prompt === undefined)
    return null;
  return {
    name: unescapeMarkup(name),
    ranAt,
    prompt: unescapeMarkup(prompt),
  };
}
