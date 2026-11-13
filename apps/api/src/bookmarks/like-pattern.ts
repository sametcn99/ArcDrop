/**
 * LIKE pattern helpers for the ILIKE search (plan D10).
 *
 * User input goes into a `LIKE`/`ILIKE` pattern, so `%`, `_` and `\` must be
 * escaped — Postgres' default LIKE escape character is the backslash. Values
 * are always passed as query parameters (never string-interpolated), so this
 * is about correct matching, not injection.
 */

/** Escapes the LIKE metacharacters so they match literally. */
export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Builds a `%needle%` contains-pattern with escaped metacharacters. */
export function containsPattern(input: string): string {
  return `%${escapeLikePattern(input)}%`;
}
