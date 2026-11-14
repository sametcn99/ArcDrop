import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import type { TagSummary } from '../../api/schemas/bookmarks';

export interface TagChipListProps {
  tags: TagSummary[];
  maxVisible?: number;
}

export function TagChipList({ tags, maxVisible }: TagChipListProps) {
  if (tags.length === 0) return null;

  const visibleTags = maxVisible !== undefined ? tags.slice(0, maxVisible) : tags;
  const hiddenCount = maxVisible !== undefined ? Math.max(0, tags.length - maxVisible) : 0;

  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
      {visibleTags.map((tag) => (
        <Chip key={tag.id} size="small" variant="outlined" label={`#${tag.name}`} />
      ))}
      {hiddenCount > 0 ? <Chip size="small" variant="outlined" label={`+${hiddenCount}`} /> : null}
    </Stack>
  );
}
