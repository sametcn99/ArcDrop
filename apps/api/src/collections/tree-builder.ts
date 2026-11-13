import type { CollectionNodeDto } from './collections.dto';

/** The row view of an ACTIVE collection the tree is built from. */
export interface CollectionTreeRow {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  color: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Sibling order: `order` ASC, then `createdAt` ASC (millisecond ties are
 * real), then `id` ASC as the deterministic last resort. The SAME comparator
 * backs the flat list's per-parent grouping and the tree's sibling arrays.
 */
export function compareSiblings(a: CollectionTreeRow, b: CollectionTreeRow): number {
  if (a.order !== b.order) return a.order - b.order;
  const at = a.createdAt.getTime();
  const bt = b.createdAt.getTime();
  if (at !== bt) return at - bt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Builds the nested collection tree (plan M4) from the user's ACTIVE rows:
 *
 * - A node whose parent is `null` or NOT among the rows becomes a root —
 *   a restored child under a still-trashed parent is promoted to the root
 *   level instead of disappearing (the flat list keeps the raw `parentId`).
 * - `bookmarkCount` comes from the pre-aggregated counts map (active
 *   bookmarks with a direct membership); rows without an entry count 0.
 *   Counts are DIRECT — a parent does not add its subtree's counts on.
 * - Siblings (roots included) are sorted with `compareSiblings` at every
 *   level.
 *
 * A parent_id cycle among the rows (unreachable through the API — PUT
 * refuses cycle moves) would make those nodes unreachable from any root;
 * they are dropped from the tree rather than looped over forever.
 */
export function buildCollectionTree(
  rows: readonly CollectionTreeRow[],
  counts: ReadonlyMap<string, number> = new Map(),
): CollectionNodeDto[] {
  const nodes = new Map<string, CollectionNodeDto>();
  for (const row of rows) {
    nodes.set(row.id, {
      id: row.id,
      parentId: row.parentId,
      title: row.title,
      icon: row.icon,
      color: row.color,
      order: row.order,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      bookmarkCount: counts.get(row.id) ?? 0,
      children: [],
    });
  }

  const roots: CollectionNodeDto[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId !== null ? nodes.get(node.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortLevel = (level: CollectionNodeDto[]): void => {
    level.sort(compareSiblings);
    for (const node of level) sortLevel(node.children);
  };
  sortLevel(roots);

  return roots;
}
