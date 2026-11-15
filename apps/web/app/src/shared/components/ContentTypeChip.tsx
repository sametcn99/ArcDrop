import Chip from '@mui/material/Chip';
import type { BookmarkContentType } from '../../api/schemas/bookmarks';
import { ContentTypeIcon } from './ContentTypeIcon';

export interface ContentTypeChipProps {
  contentType: BookmarkContentType;
  /** Renders without the outlined border (bookmark list/grid/headline cards). */
  borderless?: boolean;
}

const CONTENT_TYPE_LABELS: Record<BookmarkContentType, string> = {
  article: 'Article',
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  document: 'Document',
  book: 'Book',
  link: 'Link',
};

export function ContentTypeChip({ contentType, borderless = false }: ContentTypeChipProps) {
  return (
    <Chip
      size="small"
      variant={borderless ? 'filled' : 'outlined'}
      icon={<ContentTypeIcon contentType={contentType} />}
      label={CONTENT_TYPE_LABELS[contentType]}
    />
  );
}
