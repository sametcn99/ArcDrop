import { describe, expect, it } from 'bun:test';
import { findRecursivelyEmptyCollectionIds, planAlphabeticalSort } from './collection-bulk-helpers';
import type { CollectionTreeRow } from './tree-builder';

function row(
  id: string,
  title: string,
  parentId: string | null = null,
  order = 0,
): CollectionTreeRow {
  const ts = new Date('2026-01-01T00:00:00.000Z');
  return {
    id,
    parentId,
    title,
    icon: null,
    color: null,
    order,
    createdAt: ts,
    updatedAt: ts,
  };
}

describe('collection-bulk-helpers', () => {
  describe('planAlphabeticalSort', () => {
    it('sorts roots and every nested parent level alphabetically and emits only changed orders', () => {
      const rows: CollectionTreeRow[] = [
        row('r-z', 'Zebra', null, 0),
        row('r-a', 'alpha', null, 1),
        row('r-m', 'Middle', null, 2),
        row('c-b', 'Beta', 'r-a', 0),
        row('c-a', 'Alpha', 'r-a', 1),
        // Already sorted subtree — should produce zero updates
        row('d-1', 'First', 'r-m', 0),
        row('d-2', 'Second', 'r-m', 1),
      ];

      const updates = planAlphabeticalSort(rows);
      expect(updates).toEqual([
        { id: 'r-a', order: 0 },
        { id: 'r-m', order: 1 },
        { id: 'r-z', order: 2 },
        { id: 'c-a', order: 0 },
        { id: 'c-b', order: 1 },
      ]);
    });

    it('breaks equal-title ties deterministically without touching already-ordered groups', () => {
      const rows = [row('b', 'Same', null, 1), row('a', 'Same', null, 0)];
      expect(planAlphabeticalSort(rows)).toEqual([]);
    });
  });

  describe('findRecursivelyEmptyCollectionIds', () => {
    it('keeps ancestors of non-empty grandchildren and marks empty branches/subtrees', () => {
      const rows = [
        { id: 'root-full', parentId: null },
        { id: 'mid-empty', parentId: 'root-full' },
        { id: 'mid-full', parentId: 'root-full' },
        { id: 'leaf-full', parentId: 'mid-full' },
        { id: 'root-empty', parentId: null },
        { id: 'child-empty', parentId: 'root-empty' },
      ];
      const counts = new Map<string, number>([['leaf-full', 2]]);

      expect(findRecursivelyEmptyCollectionIds(rows, counts).sort()).toEqual([
        'child-empty',
        'mid-empty',
        'root-empty',
      ]);
    });

    it('guards against cycles without looping infinitely', () => {
      const rows = [
        { id: 'a', parentId: 'b' },
        { id: 'b', parentId: 'a' },
      ];
      expect(findRecursivelyEmptyCollectionIds(rows, new Map()).sort()).toEqual(['a', 'b']);
    });
  });
});
