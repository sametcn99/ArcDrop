import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { PublicBookmark } from '../../../api/schemas/publicShare';
import { ContentTypeIcon } from '../../../shared/components/ContentTypeIcon';
import { PUBLIC_SHARE_STRINGS as S } from '../strings';

export interface PublicBookmarkCardProps {
  bookmark: PublicBookmark;
}

export function PublicBookmarkCard({ bookmark }: PublicBookmarkCardProps) {
  const href = bookmark.url ?? undefined;
  const body = (
    <CardContent>
      <Stack spacing={0.75}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <ContentTypeIcon contentType={bookmark.contentType} />
          <Typography variant="subtitle1" noWrap>
            {bookmark.title ?? bookmark.url ?? S.fileItem}
          </Typography>
        </Stack>
        {bookmark.excerpt ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {bookmark.excerpt}
          </Typography>
        ) : null}
        {bookmark.url ? (
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <LinkOutlinedIcon fontSize="small" />
            <Typography variant="caption" color="text.secondary" noWrap component="span">
              {bookmark.url}
            </Typography>
          </Stack>
        ) : (
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <DescriptionOutlinedIcon fontSize="small" />
            <Typography variant="caption" color="text.secondary">
              {S.fileItem}
            </Typography>
          </Stack>
        )}
        {bookmark.tags.length > 0 ? (
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
            {bookmark.tags.map((tag) => (
              <Chip key={tag} size="small" variant="outlined" label={`#${tag}`} />
            ))}
          </Stack>
        ) : null}
        <Typography variant="caption" color="text.secondary">
          {new Date(bookmark.createdAt).toLocaleDateString()}
        </Typography>
      </Stack>
    </CardContent>
  );

  return (
    <Card variant="outlined" data-testid="public-bookmark-card">
      {href ? (
        <CardActionArea href={href} target="_blank" rel="noopener noreferrer">
          {body}
        </CardActionArea>
      ) : (
        <Box>{body}</Box>
      )}
    </Card>
  );
}
