import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import { useEffect, useState } from 'react';
import { bookmarksApi } from '../../api/endpoints/bookmarks';
import type { BookmarkContentType } from '../../api/schemas/bookmarks';
import { BookmarkIconBadge } from './BookmarkIconBadge';

export interface AuthenticatedFilePreviewProps {
  bookmarkId: string;
  contentType: BookmarkContentType;
  alt: string;
  variant?: 'thumbnail' | 'banner';
  size?: number;
  maxHeight?: number;
}

/**
 * Module-level blob URL cache. Without it every mount of a preview —
 * drawer open/close, layout switch, background-location remount —
 * re-downloaded the FULL file and kept one blob per mounted row.
 *
 * Entries are refcounted (several rows can show the same file) and the cache
 * is LRU-capped: zero-ref entries beyond the cap are revoked immediately, so
 * memory stays bounded while recently viewed previews stay instant.
 */
interface BlobCacheEntry {
  objectUrl: string;
  refs: number;
}

const BLOB_CACHE_LIMIT = 60;
const blobCache = new Map<string, BlobCacheEntry>(); // Map iteration = insertion (LRU) order

function evictStaleBlobEntries(): void {
  if (blobCache.size <= BLOB_CACHE_LIMIT) return;
  for (const [id, entry] of blobCache) {
    if (blobCache.size <= BLOB_CACHE_LIMIT) break;
    if (entry.refs > 0) continue;
    blobCache.delete(id);
    if (typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(entry.objectUrl);
    }
  }
}

function acquireCachedObjectUrl(bookmarkId: string): string | null {
  const entry = blobCache.get(bookmarkId);
  if (!entry) return null;
  // Touch for LRU ordering.
  blobCache.delete(bookmarkId);
  blobCache.set(bookmarkId, entry);
  entry.refs += 1;
  return entry.objectUrl;
}

/** Render-safe lookup (no ref counting — effects own the refcount). */
function peekCachedObjectUrl(bookmarkId: string): string | null {
  return blobCache.get(bookmarkId)?.objectUrl ?? null;
}

function storeAndAcquireObjectUrl(bookmarkId: string, blob: Blob): string | null {
  if (typeof URL.createObjectURL !== 'function' || blob.size === 0) {
    return null;
  }
  const objectUrl = URL.createObjectURL(blob);
  blobCache.set(bookmarkId, { objectUrl, refs: 1 });
  evictStaleBlobEntries();
  return objectUrl;
}

function releaseObjectUrl(bookmarkId: string): void {
  const entry = blobCache.get(bookmarkId);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs === 0 && blobCache.size > BLOB_CACHE_LIMIT) {
    blobCache.delete(bookmarkId);
    if (typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(entry.objectUrl);
    }
  }
}

export function AuthenticatedFilePreview({
  bookmarkId,
  contentType,
  alt,
  variant = 'thumbnail',
  size = 48,
  maxHeight = 160,
}: AuthenticatedFilePreviewProps) {
  const [failedId, setFailedId] = useState<string | null>(null);
  // Bumped after a fetch stores its entry so the render below re-reads the
  // cache map (setState with a new value guarantees the re-render).
  const [, setFetchedTick] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    // Cache hits render from the shared entry directly (see activeUrl below);
    // the effect only owns the refcount and the initial network fetch.
    if (acquireCachedObjectUrl(bookmarkId)) {
      return () => {
        releaseObjectUrl(bookmarkId);
      };
    }

    bookmarksApi
      .getFileBlob(bookmarkId, { signal: controller.signal })
      .then((res) => {
        if (!active) return;
        const objectUrl = storeAndAcquireObjectUrl(bookmarkId, res.blob);
        if (!objectUrl) {
          setFailedId(bookmarkId);
          return;
        }
        setFailedId(null);
        setFetchedTick((tick) => tick + 1);
      })
      .catch(() => {
        if (!active || controller.signal.aborted) return;
        setFailedId(bookmarkId);
      });

    return () => {
      active = false;
      controller.abort();
      releaseObjectUrl(bookmarkId);
    };
  }, [bookmarkId]);

  const activeUrl = peekCachedObjectUrl(bookmarkId);
  const hasFailed = failedId === bookmarkId;

  if (hasFailed) {
    if (variant === 'banner') {
      return null;
    }
    return <BookmarkIconBadge iconRef={null} contentType={contentType} alt={alt} size={size} />;
  }

  if (!activeUrl) {
    if (variant === 'banner') {
      return (
        <Skeleton
          variant="rounded"
          width="100%"
          height={maxHeight}
          aria-label={`Loading preview for ${alt}`}
        />
      );
    }
    return (
      <Skeleton
        variant="rounded"
        width={size}
        height={size}
        sx={{ flexShrink: 0 }}
        aria-label={`Loading preview for ${alt}`}
      />
    );
  }

  if (variant === 'banner') {
    return (
      <Box
        component="img"
        src={activeUrl}
        alt={alt}
        data-testid={`file-image-preview-${bookmarkId}`}
        sx={{
          width: '100%',
          maxHeight,
          objectFit: 'cover',
          borderRadius: 1,
          display: 'block',
          bgcolor: 'action.hover',
        }}
      />
    );
  }

  return (
    <Box
      component="img"
      src={activeUrl}
      alt={alt}
      data-testid={`file-image-preview-${bookmarkId}`}
      sx={{
        width: size,
        height: size,
        objectFit: 'cover',
        borderRadius: 1,
        flexShrink: 0,
        display: 'block',
        bgcolor: 'action.hover',
      }}
    />
  );
}
