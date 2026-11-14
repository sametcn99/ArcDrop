import type { Collection, CollectionNode } from '../../api/schemas/collections';
import { compareCollections } from '../../stores/libraryStore';

export const COLLECTION_ICON_OPTIONS = [
  { key: 'folder', label: 'Folder' },
  { key: 'bookmark', label: 'Bookmark' },
  { key: 'star', label: 'Star' },
  { key: 'work', label: 'Work' },
  { key: 'code', label: 'Code' },
  { key: 'book', label: 'Reading' },
  { key: 'image', label: 'Gallery' },
  { key: 'video', label: 'Video' },
  { key: 'music', label: 'Audio' },
  { key: 'link', label: 'Links' },
  { key: 'lightbulb', label: 'Ideas' },
  { key: 'school', label: 'Study' },
] as const;

export function buildCollectionTree(collections: Collection[]): CollectionNode[] {
  const byId = new Map<string, CollectionNode>();
  for (const col of collections) {
    byId.set(col.id, { ...col, children: [] });
  }

  const roots: CollectionNode[] = [];
  for (const col of collections) {
    const node = byId.get(col.id);
    if (!node) continue;
    const parent = col.parentId ? byId.get(col.parentId) : undefined;
    if (parent && parent.id !== node.id) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortRecursive = (nodes: CollectionNode[], visited = new Set<string>()) => {
    nodes.sort(compareCollections);
    for (const node of nodes) {
      if (visited.has(node.id)) {
        node.children = [];
        continue;
      }
      visited.add(node.id);
      sortRecursive(node.children, visited);
    }
  };

  sortRecursive(roots);
  return roots;
}

export function flattenCollectionNodes(nodes: CollectionNode[]): Collection[] {
  const flat: Collection[] = [];
  const visit = (node: CollectionNode) => {
    const { children, ...collection } = node;
    flat.push(collection);
    for (const child of children) {
      visit(child);
    }
  };
  for (const node of nodes) {
    visit(node);
  }
  return flat;
}

export function collectDescendantIds(
  collectionsById: Record<string, Collection>,
  rootId: string,
): Set<string> {
  const result = new Set<string>();
  const childrenByParent = new Map<string, string[]>();

  for (const col of Object.values(collectionsById)) {
    if (!col.parentId) continue;
    const list = childrenByParent.get(col.parentId) ?? [];
    list.push(col.id);
    childrenByParent.set(col.parentId, list);
  }

  const stack = [...(childrenByParent.get(rootId) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next || next === rootId || result.has(next)) continue;
    result.add(next);
    const grandChildren = childrenByParent.get(next);
    if (grandChildren) {
      for (const childId of grandChildren) {
        stack.push(childId);
      }
    }
  }

  return result;
}

export function getCollectionAncestors(
  collectionsById: Record<string, Collection>,
  collectionId: string,
): Collection[] {
  const ancestors: Collection[] = [];
  const visited = new Set<string>([collectionId]);
  let current = collectionsById[collectionId];

  while (current?.parentId) {
    if (visited.has(current.parentId)) break;
    visited.add(current.parentId);
    const parent = collectionsById[current.parentId];
    if (!parent) break;
    ancestors.unshift(parent);
    current = parent;
  }

  return ancestors;
}

export function getSiblingCollections(
  collectionsById: Record<string, Collection>,
  parentId: string | null,
): Collection[] {
  return Object.values(collectionsById)
    .filter((col) => col.parentId === parentId)
    .sort(compareCollections);
}
