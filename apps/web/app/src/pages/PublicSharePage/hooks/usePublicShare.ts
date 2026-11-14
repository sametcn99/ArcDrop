import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { publicShareApi } from '../../../api/endpoints/publicShare';
import type { PublicCollectionPage } from '../../../api/schemas/publicShare';
import { toApiError } from '../../../api/schemas/problem';

export interface PublicShareState {
  page: PublicCollectionPage | null;
  loading: boolean;
  notFound: boolean;
  error: string | null;
  loadMore: () => Promise<void>;
  hasMore: boolean;
}

export function usePublicShare(): PublicShareState {
  const { token } = useParams<{ token: string }>();
  const [page, setPage] = useState<PublicCollectionPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    publicShareApi
      .getPublicCollection(token ?? '')
      .then((result) => {
        if (!cancelled) setPage(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const apiError = toApiError(err);
        if (apiError.status === 404) {
          setNotFound(true);
        } else {
          setError(apiError.detail);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const loadMore = useCallback(async () => {
    if (!page) return;
    const nextPage = page.page + 1;
    try {
      const result = await publicShareApi.getPublicCollection(token ?? '', nextPage, page.pageSize);
      setPage((prev) =>
        prev ? { ...result, items: [...prev.items, ...result.items] } : result,
      );
    } catch {
      // pagination failures keep the current content; user can retry
    }
  }, [page, token]);

  const loadedCount = page?.items.length ?? 0;
  const hasMore = page !== null && loadedCount < page.totalCount;

  return { page, loading, notFound, error, loadMore, hasMore };
}
