import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type {
  BookmarkCacheStatus,
  BookmarkContentType,
  BookmarkSort,
} from '../../api/schemas/bookmarks';
import {
  useLibraryStore,
  type LibraryLayoutMode,
  type LibraryScope,
} from '../../stores/libraryStore';
import {
  hasActiveFilters,
  hasActiveSearchOrFilters,
  normalizeTagsParam,
  parseDateParam,
  parseUrlState,
  type BookmarkFilterState,
} from '../utils/searchFilters';

export {
  buildBookmarkApiQuery,
  EMPTY_FILTER_STATE,
  formatSearchTagToken,
  hasActiveFilters,
  hasActiveSearchOrFilters,
  parseFilterState,
  parseUrlState,
  serializeFilterKey,
  serializeFilterParams,
  type BookmarkFilterState,
  type UrlViewState,
} from '../utils/searchFilters';

export interface UseUrlStateOptions {
  allowManualSort?: boolean;
}

export function useUrlState(options: UseUrlStateOptions = {}) {
  const allowManualSort = options.allowManualSort ?? false;
  const [searchParams, setSearchParams] = useSearchParams();

  const parsed = useMemo(
    () => parseUrlState(searchParams, { allowManualSort }),
    [allowManualSort, searchParams],
  );

  const tagsKey = parsed.tags.join('\0');
  const stableTags = useMemo(() => (tagsKey === '' ? [] : tagsKey.split('\0')), [tagsKey]);

  const filters: BookmarkFilterState = useMemo(
    () => ({
      search: parsed.search,
      type: parsed.type,
      tags: stableTags,
      favorite: parsed.favorite,
      notag: parsed.notag,
      broken: parsed.broken,
      file: parsed.file,
      createdFrom: parsed.createdFrom,
      createdTo: parsed.createdTo,
      cacheStatus: parsed.cacheStatus,
      domain: parsed.domain,
      updatedFrom: parsed.updatedFrom,
      updatedTo: parsed.updatedTo,
      matchOr: parsed.matchOr,
    }),
    [
      parsed.broken,
      parsed.cacheStatus,
      parsed.createdFrom,
      parsed.createdTo,
      parsed.domain,
      parsed.favorite,
      parsed.file,
      parsed.matchOr,
      parsed.notag,
      parsed.search,
      parsed.type,
      parsed.updatedFrom,
      parsed.updatedTo,
      stableTags,
    ],
  );

  const urlState = useMemo(
    () => ({
      view: parsed.view,
      sort: parsed.sort,
      layout: parsed.layout,
      ...filters,
    }),
    [filters, parsed.layout, parsed.sort, parsed.view],
  );

  const storeLayoutMode = useLibraryStore((s) => s.layoutMode);
  const setStoreLayoutMode = useLibraryStore((s) => s.setLayoutMode);

  useEffect(() => {
    if (urlState.layout !== storeLayoutMode) {
      setStoreLayoutMode(urlState.layout);
    }
  }, [setStoreLayoutMode, storeLayoutMode, urlState.layout]);

  const updateParams = useCallback(
    (mutator: (next: URLSearchParams) => void) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        mutator(next);
        return next;
      });
    },
    [setSearchParams],
  );

  const setView = useCallback(
    (nextView: LibraryScope) => {
      updateParams((next) => {
        if (nextView === 'all') {
          next.delete('view');
        } else {
          next.set('view', nextView);
        }
      });
    },
    [updateParams],
  );

  const setSort = useCallback(
    (nextSort: BookmarkSort) => {
      updateParams((next) => {
        if (nextSort === 'updated') {
          next.delete('sort');
        } else {
          next.set('sort', nextSort);
        }
      });
    },
    [updateParams],
  );

  const setLayout = useCallback(
    (nextLayout: LibraryLayoutMode) => {
      setStoreLayoutMode(nextLayout);
      updateParams((next) => {
        if (nextLayout === 'list') {
          next.delete('layout');
        } else {
          next.set('layout', nextLayout);
        }
      });
    },
    [setStoreLayoutMode, updateParams],
  );

  const setSearch = useCallback(
    (nextSearch: string) => {
      const trimmed = nextSearch.trim();
      updateParams((next) => {
        if (trimmed === '') {
          next.delete('search');
        } else {
          next.set('search', trimmed);
        }
      });
    },
    [updateParams],
  );

  const setType = useCallback(
    (nextType: BookmarkContentType | null) => {
      updateParams((next) => {
        if (nextType === null) {
          next.delete('type');
        } else {
          next.set('type', nextType);
        }
      });
    },
    [updateParams],
  );

  const addTag = useCallback(
    (tagName: string) => {
      const cleaned = tagName.trim().replace(/^#+/, '').trim();
      if (!cleaned) return;
      updateParams((next) => {
        const current = normalizeTagsParam(next.getAll('tag'));
        if (current.some((t) => t.toLowerCase() === cleaned.toLowerCase())) {
          return;
        }
        next.delete('tag');
        for (const tag of [...current, cleaned]) {
          next.append('tag', tag);
        }
      });
    },
    [updateParams],
  );

  const removeTag = useCallback(
    (tagName: string) => {
      const targetLower = tagName.trim().toLowerCase();
      updateParams((next) => {
        const remaining = normalizeTagsParam(next.getAll('tag')).filter(
          (t) => t.toLowerCase() !== targetLower,
        );
        next.delete('tag');
        for (const tag of remaining) {
          next.append('tag', tag);
        }
      });
    },
    [updateParams],
  );

  const toggleTag = useCallback(
    (tagName: string) => {
      const cleaned = tagName.trim().replace(/^#+/, '').trim();
      if (!cleaned) return;
      const targetLower = cleaned.toLowerCase();
      updateParams((next) => {
        const current = normalizeTagsParam(next.getAll('tag'));
        const exists = current.some((t) => t.toLowerCase() === targetLower);
        const updated = exists
          ? current.filter((t) => t.toLowerCase() !== targetLower)
          : [...current, cleaned];
        next.delete('tag');
        for (const tag of updated) {
          next.append('tag', tag);
        }
      });
    },
    [updateParams],
  );

  const setFavorite = useCallback(
    (enabled: boolean) => {
      updateParams((next) => {
        if (enabled) next.set('favorite', 'true');
        else next.delete('favorite');
      });
    },
    [updateParams],
  );

  const setNotag = useCallback(
    (enabled: boolean) => {
      updateParams((next) => {
        if (enabled) next.set('notag', 'true');
        else next.delete('notag');
      });
    },
    [updateParams],
  );

  const setBroken = useCallback(
    (enabled: boolean) => {
      updateParams((next) => {
        if (enabled) next.set('broken', 'true');
        else next.delete('broken');
      });
    },
    [updateParams],
  );

  const setFile = useCallback(
    (enabled: boolean) => {
      updateParams((next) => {
        if (enabled) next.set('file', 'true');
        else next.delete('file');
      });
    },
    [updateParams],
  );

  const setCreatedRange = useCallback(
    (from: string, to: string) => {
      const validFrom = parseDateParam(from);
      const validTo = parseDateParam(to);
      updateParams((next) => {
        if (validFrom) next.set('createdFrom', validFrom);
        else next.delete('createdFrom');
        if (validTo) next.set('createdTo', validTo);
        else next.delete('createdTo');
      });
    },
    [updateParams],
  );

  const setUpdatedRange = useCallback(
    (from: string, to: string) => {
      const validFrom = parseDateParam(from);
      const validTo = parseDateParam(to);
      updateParams((next) => {
        if (validFrom) next.set('updatedFrom', validFrom);
        else next.delete('updatedFrom');
        if (validTo) next.set('updatedTo', validTo);
        else next.delete('updatedTo');
      });
    },
    [updateParams],
  );

  const setCacheStatus = useCallback(
    (nextStatus: BookmarkCacheStatus | null) => {
      updateParams((next) => {
        if (nextStatus === null) {
          next.delete('cacheStatus');
        } else {
          next.set('cacheStatus', nextStatus);
        }
      });
    },
    [updateParams],
  );

  const setDomain = useCallback(
    (nextDomain: string) => {
      const trimmed = nextDomain.trim().slice(0, 253);
      updateParams((next) => {
        if (trimmed === '') {
          next.delete('domain');
        } else {
          next.set('domain', trimmed);
        }
      });
    },
    [updateParams],
  );

  const setMatchOr = useCallback(
    (enabled: boolean) => {
      updateParams((next) => {
        if (enabled) next.set('match', 'OR');
        else next.delete('match');
      });
    },
    [updateParams],
  );

  const clearFilters = useCallback(() => {
    updateParams((next) => {
      next.delete('type');
      next.delete('tag');
      next.delete('favorite');
      next.delete('notag');
      next.delete('broken');
      next.delete('file');
      next.delete('createdFrom');
      next.delete('createdTo');
      next.delete('updatedFrom');
      next.delete('updatedTo');
      next.delete('cacheStatus');
      next.delete('domain');
      next.delete('match');
    });
  }, [updateParams]);

  const clearSearchAndFilters = useCallback(() => {
    updateParams((next) => {
      next.delete('search');
      next.delete('type');
      next.delete('tag');
      next.delete('favorite');
      next.delete('notag');
      next.delete('broken');
      next.delete('file');
      next.delete('createdFrom');
      next.delete('createdTo');
      next.delete('updatedFrom');
      next.delete('updatedTo');
      next.delete('cacheStatus');
      next.delete('domain');
      next.delete('match');
    });
  }, [updateParams]);

  return {
    urlState,
    filters,
    hasFilters: hasActiveFilters(filters),
    hasSearchOrFilters: hasActiveSearchOrFilters(filters),
    setView,
    setSort,
    setLayout,
    setSearch,
    setType,
    addTag,
    removeTag,
    toggleTag,
    setFavorite,
    setNotag,
    setBroken,
    setFile,
    setCreatedRange,
    setUpdatedRange,
    setCacheStatus,
    setDomain,
    setMatchOr,
    clearFilters,
    clearSearchAndFilters,
  };
}
