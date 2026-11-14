import { compareSiblings, type CollectionTreeRow } from './tree-builder';

export interface CollectionOrderUpdate {
  id: string;
  order: number;
}

export interface CollectionHierarchyRow {
  id: string;
  parentId: string | null;
}

/**
 * Computes alphabetical sibling order updates across EVERY sibling group
 * (roots `parentId === null` plus every parent's children at all depths).
 * Uses case-insensitive base comparison first, then exact case-sensitive
 * tie-break, then `compareSiblings` so equal titles stay deterministic.
 * Only rows whose normalized `order` index changes are returned.
 */
export function planAlphabeticalSort(rows: readonly CollectionTreeRow[]): CollectionOrderUpdate[] {
  const byParent = new Map<string | null, CollectionTreeRow[]>();
  for (const row of rows) {
    const key = row.parentId ?? null;
    let group = byParent.get(key);
    if (!group) {
      group = [];
      byParent.set(key, group);
    }
    group.push(row);
  }

  const updates: CollectionOrderUpdate[] = [];
  for (const group of byParent.values()) {
    const sorted = [...group].sort((a, b) => {
      const baseCmp = a.title.localeCompare(b.title, 'en', { sensitivity: 'base' });
      if (baseCmp !== 0) return baseCmp;
      const exactCmp = a.title.localeCompare(b.title, 'en');
      if (exactCmp !== 0) return exactCmp;
      return compareSiblings(a, b);
    });
    for (let index = 0; index < sorted.length; index++) {
      const row = sorted[index]!;
      if (row.order !== index) {
        updates.push({ id: row.id, order: index });
      }
    }
  }

  return updates;
}

/**
 * Returns IDs of active collections whose entire active subtree contains
 * zero active (non-trashed) bookmarks (`directCounts` counts active bookmarks
 * only, so a collection carrying only trashed bookmarks has directCount 0 and
 * counts as empty). Cycle-safe via a visiting/memo guard.
 */
export function findRecursivelyEmptyCollectionIds(
  rows: readonly CollectionHierarchyRow[],
  directCounts: ReadonlyMap<string, number>,
): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const row of rows) {
    if (row.parentId === null) continue;
    let children = childrenByParent.get(row.parentId);
    if (!children) {
      children = [];
      childrenByParent.set(row.parentId, children);
    }
    children.push(row.id);
  }

  const hasContentMemo = new Map<string, boolean>();
  const visiting = new Set<string>();

  const hasActiveContent = (id: string): boolean => {
    const cached = hasContentMemo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return false;

    visiting.add(id);
    let hasContent = (directCounts.get(id) ?? 0) > 0;
    if (!hasContent) {
      const children = childrenByParent.get(id) ?? [];
      for (const childId of children) {
        if (hasActiveContent(childId)) {
          hasContent = true;
          break;
        }
      }
    }
    visiting.delete(id);
    hasContentMemo.set(id, hasContent);
    return hasContent;
  };

  const emptyIds: string[] = [];
  for (const row of rows) {
    if (!hasActiveContent(row.id)) {
      emptyIds.push(row.id);
    }
  }
  return emptyIds;
}
