import { describe, expect, it } from 'bun:test';
import { rowsOf } from './query-rows';

/**
 * The pg driver under TypeORM 1.1.x returns different raw shapes per
 * statement type; `rowsOf` is the single normalizer every raw RETURNING
 * query goes through. These cases pin the empirical contract.
 */
describe('rowsOf', () => {
  it('passes plain row arrays through (SELECT / INSERT..RETURNING)', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    expect(rowsOf(rows)).toEqual(rows);
    expect(rowsOf([])).toEqual([]);
  });

  it('unwraps [rows, rowCount] tuples (UPDATE/DELETE..RETURNING)', () => {
    expect(rowsOf([[{ id: 'x', sync_seq: '1' }], 1])).toEqual([{ id: 'x', sync_seq: '1' }]);
    expect(rowsOf([[], 0])).toEqual([]);
  });

  it('reads .rows from QueryResult-like objects', () => {
    expect(rowsOf({ rows: [{ id: 'y' }], rowCount: 1 })).toEqual([{ id: 'y' }]);
  });

  it('never treats a two-column SELECT as a tuple', () => {
    // Row objects are objects, not arrays — this shape cannot collide.
    const rows = [{ a: 'one', b: 'two' }];
    expect(rowsOf(rows)).toEqual(rows);
  });

  it('returns [] for anything unrecognized', () => {
    expect(rowsOf(undefined)).toEqual([]);
    expect(rowsOf(null)).toEqual([]);
    expect(rowsOf('nope')).toEqual([]);
    expect(rowsOf({})).toEqual([]);
  });
});
