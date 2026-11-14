import Chip from '@mui/material/Chip';
import type { BookmarkContentType } from '../../api/schemas/bookmarks';
import { ContentTypeIcon } from './ContentTypeIcon';

export interface ContentTypeChipProps {
  contentType: BookmarkContentType;
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

export function ContentTypeChip({ contentType }: ContentTypeChipProps) {
  return (
    <Chip
      size="small"
      variant="outlined"
      icon={<ContentTypeIcon contentType={contentType} />}
      label={CONTENT_TYPE_LABELS[contentType]}
    />
  );
}
