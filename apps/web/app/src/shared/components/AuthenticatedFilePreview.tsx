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

export function AuthenticatedFilePreview({
  bookmarkId,
  contentType,
  alt,
  variant = 'thumbnail',
  size = 48,
  maxHeight = 160,
}: AuthenticatedFilePreviewProps) {
  const [loaded, setLoaded] = useState<{ bookmarkId: string; objectUrl: string } | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;
    const controller = new AbortController();

    bookmarksApi
      .getFileBlob(bookmarkId, { signal: controller.signal })
      .then((res) => {
        if (!active) return;
        if (typeof URL.createObjectURL !== 'function' || res.blob.size === 0) {
          setFailedId(bookmarkId);
          return;
        }
        createdUrl = URL.createObjectURL(res.blob);
        setFailedId(null);
        setLoaded({ bookmarkId, objectUrl: createdUrl });
      })
      .catch(() => {
        if (!active || controller.signal.aborted) return;
        setFailedId(bookmarkId);
      });

    return () => {
      active = false;
      controller.abort();
      if (createdUrl && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [bookmarkId]);

  const activeUrl = loaded?.bookmarkId === bookmarkId ? loaded.objectUrl : null;
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
