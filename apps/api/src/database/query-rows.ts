import type { EntityManager } from 'typeorm';

/**
 * Normalizes the raw result of `EntityManager.query` on the pg driver
 * (TypeORM 1.1.x) into a plain rows array.
 *
 * Empirical shapes on this driver:
 * - `SELECT`                → `Row[]`
 * - `INSERT … RETURNING`    → `Row[]`
 * - `UPDATE … RETURNING`    → `[Row[], rowCount]`
 * - `DELETE … RETURNING`    → `[Row[], rowCount]`
 *
 * The tuple shape is detected structurally (two elements: array + number) —
 * row objects from pg are always objects, never arrays, so no SELECT shape
 * can collide with it.
 */
export type RawRow = Record<string, unknown>;

export async function queryRows(
  manager: Pick<EntityManager, 'query'>,
  sql: string,
  parameters?: unknown[],
): Promise<RawRow[]> {
  const result: unknown = await manager.query(sql, parameters);
  return rowsOf(result);
}

/** Synchronous normalization — exported for tests and reuse. */
export function rowsOf(result: unknown): RawRow[] {
  if (Array.isArray(result)) {
    if (result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number') {
      return result[0] as RawRow[];
    }
    return result as RawRow[];
  }
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: RawRow[] }).rows;
  }
  return [];
}
