/**
 * The message to show for a rejected promise.
 *
 * Every panel that writes catches `unknown` and has to decide what to show
 * when it is not an `Error`. One fallback per surface, decided in one place,
 * instead of the same ternary nine times.
 */
export function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}
