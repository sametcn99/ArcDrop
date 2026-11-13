import { describe, expect, it } from 'bun:test';
import { buildCollectionTree, compareSiblings, type CollectionTreeRow } from './tree-builder';

/** Fixed ids so assertions can reference stable nodes. */
const A = '11111111-1111-4111-8111-111111111111';
const A1 = '22222222-2222-4222-8222-222222222222';
const A1a = '33333333-3333-4333-8333-333333333333';
const B = '44444444-4444-4444-8444-444444444444';

const T0 = new Date('2026-01-01T00:00:00.000Z');
const T1 = new Date('2026-01-02T00:00:00.000Z');

function row(overrides: Partial<CollectionTreeRow> & { id: string }): CollectionTreeRow {
  return {
    parentId: null,
    title: overrides.id,
    icon: null,
    color: null,
    order: 0,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

describe('compareSiblings', () => {
  it('orders by `order` first', () => {
    expect(compareSiblings(row({ id: A, order: 2 }), row({ id: B, order: 10 }))).toBeLessThan(0);
    expect(compareSiblings(row({ id: A, order: 10 }), row({ id: B, order: 2 }))).toBeGreaterThan(0);
  });

  it('breaks `order` ties by createdAt, then id', () => {
    expect(
      compareSiblings(row({ id: A, createdAt: T0 }), row({ id: B, createdAt: T1 })),
    ).toBeLessThan(0);
    expect(
      compareSiblings(row({ id: B, createdAt: T1 }), row({ id: A, createdAt: T0 })),
    ).toBeGreaterThan(0);
    // Same order + same createdAt → deterministic id tiebreak (A < B lexically here).
    expect(compareSiblings(row({ id: A }), row({ id: B }))).toBe(-1);
  });

  it('is antisymmetric and zero on identical keys', () => {
    expect(compareSiblings(row({ id: A }), row({ id: A }))).toBe(0);
  });
});

describe('buildCollectionTree', () => {
  it('builds a 3-level tree with direct counts attached', () => {
    const rows = [
      row({ id: A }),
      row({ id: B }),
      row({ id: A1, parentId: A, order: 0 }),
      row({ id: A1a, parentId: A1, order: 0 }),
    ];
    const counts = new Map([
      [A, 3],
      [A1, 1],
      [A1a, 2],
    ]);

    const tree = buildCollectionTree(rows, counts);

    expect(tree.map((node) => node.id)).toEqual([A, B]); // roots, sibling-ordered
    const a = tree[0]!;
    expect(a.bookmarkCount).toBe(3); // direct counts only — NOT 3+1+2
    expect(a.children.map((node) => node.id)).toEqual([A1]);
    expect(a.children[0]!.bookmarkCount).toBe(1);
    expect(a.children[0]!.children.map((node) => node.id)).toEqual([A1a]);
    expect(a.children[0]!.children[0]!.bookmarkCount).toBe(2);
    expect(a.children[0]!.children[0]!.children).toEqual([]);
    expect(tree[1]!.bookmarkCount).toBe(0); // no memberships → 0, not NaN
  });

  it('sorts every sibling level by the shared comparator', () => {
    const rows = [
      row({ id: A, order: 1 }),
      row({ id: B, order: 0 }),
      row({ id: A1, parentId: A, order: 5, createdAt: T1 }),
      row({ id: A1a, parentId: A, order: 5, createdAt: T0 }),
    ];
    const tree = buildCollectionTree(rows, new Map());
    expect(tree.map((node) => node.id)).toEqual([B, A]);
    expect(tree[1]!.children.map((node) => node.id)).toEqual([A1a, A1]); // createdAt tiebreak
  });

  it('promotes a child whose parent is missing from the active rows', () => {
    // Parent A is trashed (absent from the rows), its child survives.
    const rows = [row({ id: A1, parentId: A })];
    const tree = buildCollectionTree(rows, new Map());
    expect(tree.map((node) => node.id)).toEqual([A1]);
    expect(tree[0]!.parentId).toBe(A); // the RAW parentId is preserved
    expect(tree[0]!.children).toEqual([]);
  });

  it('preserves raw parentIds on normal roots and drops data-cycle members', () => {
    // Cycle unreachable through the API: X.parent = Y, Y.parent = X.
    const X = '66666666-6666-4666-8666-666666666666';
    const Y = '77777777-7777-4777-8777-777777777777';
    const rows = [row({ id: A }), row({ id: X, parentId: Y }), row({ id: Y, parentId: X })];
    const tree = buildCollectionTree(rows, new Map());
    expect(tree.map((node) => node.id)).toEqual([A]); // cycle members dropped, no infinite loop
  });

  it('returns an empty array for no rows', () => {
    expect(buildCollectionTree([], new Map())).toEqual([]);
    expect(buildCollectionTree([], new Map([[A, 5]]))).toEqual([]);
  });
});
