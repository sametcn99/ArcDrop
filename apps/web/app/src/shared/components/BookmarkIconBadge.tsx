import Avatar from '@mui/material/Avatar';
import { bookmarksApi } from '../../api/endpoints/bookmarks';
import type { BookmarkContentType } from '../../api/schemas/bookmarks';
import { ContentTypeIcon } from './ContentTypeIcon';

export interface BookmarkIconBadgeProps {
  iconRef: string | null;
  contentType: BookmarkContentType;
  alt?: string;
  size?: number;
}

export function BookmarkIconBadge({
  iconRef,
  contentType,
  alt = '',
  size = 36,
}: BookmarkIconBadgeProps) {
  const src = iconRef ? bookmarksApi.iconUrl(iconRef) : undefined;

  return (
    <Avatar
      src={src}
      alt={alt}
      variant="rounded"
      sx={{
        width: size,
        height: size,
        bgcolor: 'action.selected',
        color: 'text.secondary',
        flexShrink: 0,
      }}
    >
      <ContentTypeIcon contentType={contentType} />
    </Avatar>
  );
}
