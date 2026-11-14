import { createContext, useContext } from 'react';
import type { Bookmark } from '../../api/schemas/bookmarks';

export type DragItemData =
  | {
      kind: 'collection';
      collectionId: string;
      parentId: string | null;
      title: string;
    }
  | {
      kind: 'bookmark';
      bookmarkId: string;
      bookmark: Bookmark;
    };

export type DropTargetData =
  | {
      kind: 'collection-drop';
      collectionId: string;
    }
  | {
      kind: 'collection-reorder';
      targetId: string;
      parentId: string | null;
      position: 'before' | 'after';
    }
  | {
      kind: 'collection-root-drop';
    };

export interface AppDndContextValue {
  hasProvider: boolean;
  activeDrag: DragItemData | null;
  manualSortContext: {
    collectionId: string;
    viewKey: string;
    orderedIds: string[];
  } | null;
  setManualSortContext: (
    ctx: {
      collectionId: string;
      viewKey: string;
      orderedIds: string[];
    } | null,
  ) => void;
}

const DEFAULT_VALUE: AppDndContextValue = {
  hasProvider: false,
  activeDrag: null,
  manualSortContext: null,
  setManualSortContext: () => undefined,
};

export const AppDndContext = createContext<AppDndContextValue>(DEFAULT_VALUE);

export function useAppDnd(): AppDndContextValue {
  return useContext(AppDndContext);
}

export function buildBookmarkDragId(bookmarkId: string): string {
  return `bm:${bookmarkId}`;
}

export function buildCollectionDragId(collectionId: string): string {
  return `col:${collectionId}`;
}

export function buildCollectionDropId(collectionId: string): string {
  return `col-drop:${collectionId}`;
}

export function buildCollectionReorderId(
  collectionId: string,
  position: 'before' | 'after' = 'before',
): string {
  return `col-reorder-${position}:${collectionId}`;
}

export const COLLECTION_ROOT_DROP_ID = 'col-root-drop';
