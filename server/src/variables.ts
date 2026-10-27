import { RE2JS } from 're2js';

export const MAX_VARIABLE_PATTERN_CHARS = 256;

/**
 * Filter the attempt-local variable view without exposing values to the
 * selector. Exact names take precedence over regular-expression syntax.
 */
export function filterVariables(
  variables: Readonly<Record<string, string>>,
  pattern?: string,
): { name: string; value: string }[] {
  const entries = Object.entries(variables).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  if (pattern === undefined || pattern === '*') return asVariables(entries);
  const exact = entries.find(([name]) => name === pattern);
  if (exact !== undefined) return asVariables([exact]);
  if (Array.from(pattern).length > MAX_VARIABLE_PATTERN_CHARS) {
    throw new Error(
      `Variable pattern limit of ${String(MAX_VARIABLE_PATTERN_CHARS)} characters exceeded`,
    );
  }
  let matcher: RE2JS;
  try {
    matcher = RE2JS.compile(pattern);
  } catch {
    throw new Error('Invalid or unsupported variable pattern');
  }
  return asVariables(entries.filter(([name]) => matcher.test(name)));
}

function asVariables(
  entries: readonly (readonly [string, string])[],
): { name: string; value: string }[] {
  return entries.map(([name, value]) => ({ name, value }));
}
