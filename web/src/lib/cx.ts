/** Join truthy class-name parts with single spaces. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts
    .filter(
      (part): part is string => typeof part === 'string' && part.length > 0,
    )
    .join(' ');
}
