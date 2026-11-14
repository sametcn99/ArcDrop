import RssFeedOutlinedIcon from '@mui/icons-material/RssFeedOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useParams } from 'react-router';
import { publicShareApi } from '../../api/endpoints/publicShare';
import { ThemeSwitcher } from '../../shared/components/ThemeSwitcher';
import { PublicBookmarkCard } from './components/PublicBookmarkCard';
import { usePublicShare } from './hooks/usePublicShare';
import { PUBLIC_SHARE_STRINGS as S } from './strings';

function renderNodeCounts(
  node: { id: string; title: string; bookmarkCount: number },
  depth = 0,
): React.ReactNode {
  return (
    <Chip
      key={node.id}
      size="small"
      variant={depth === 0 ? 'filled' : 'outlined'}
      label={`${node.title} · ${node.bookmarkCount}`}
      sx={depth > 0 ? { ml: 1 } : undefined}
    />
  );
}

function collectNodes(
  node: { id: string; title: string; bookmarkCount: number; children: unknown[] },
  depth = 0,
  acc: React.ReactNode[] = [],
): React.ReactNode[] {
  acc.push(renderNodeCounts(node, depth));
  for (const child of node.children as Array<Parameters<typeof collectNodes>[0]>) {
    collectNodes(child, depth + 1, acc);
  }
  return acc;
}

export default function PublicSharePage() {
  const { token } = useParams<{ token: string }>();
  const { page, loading, notFound, error, loadMore, hasMore } = usePublicShare();

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default' }}>
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="overline">{S.title}</Typography>
          <ThemeSwitcher />
        </Stack>
        <Divider sx={{ my: 2 }} />

        {loading ? (
          <Stack spacing={2} data-testid="public-share-loading">
            <Skeleton variant="rounded" height={56} />
            <Skeleton variant="rounded" height={120} />
            <Skeleton variant="rounded" height={120} />
          </Stack>
        ) : notFound ? (
          <Stack spacing={2} sx={{ alignItems: 'flex-start' }} data-testid="public-share-not-found">
            <Alert severity="warning">
              <Typography variant="subtitle1">{S.notFoundTitle}</Typography>
              <Typography variant="body2">{S.notFoundDescription}</Typography>
            </Alert>
          </Stack>
        ) : error ? (
          <Alert severity="error" data-testid="public-share-error">
            {S.errorTitle}: {error}
          </Alert>
        ) : page ? (
          <Stack spacing={3}>
            <Stack spacing={1} data-testid="public-share-header">
              <Typography variant="h4" component="h1">
                {page.collection.title}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {page.collectionPath}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                {collectNodes(page.collection)}
                <Chip
                  size="small"
                  color="primary"
                  variant="outlined"
                  label={S.bookmarksCount(page.totalCount)}
                />
              </Stack>
            </Stack>

            <Button
              startIcon={<RssFeedOutlinedIcon />}
              size="small"
              href={publicShareApi.rssUrl(token ?? '')}
              target="_blank"
              data-testid="public-share-rss"
            >
              {S.rssButton}
            </Button>

            {page.items.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {S.emptyTitle}
              </Typography>
            ) : (
              <Stack spacing={2} data-testid="public-share-items">
                {page.items.map((bookmark, index) => (
                  <PublicBookmarkCard
                    key={`${bookmark.url ?? 'file'}-${bookmark.createdAt}-${index}`}
                    bookmark={bookmark}
                  />
                ))}
              </Stack>
            )}

            {hasMore ? (
              <Button
                variant="outlined"
                onClick={() => void loadMore()}
                data-testid="public-share-load-more"
              >
                {S.loadMore}
              </Button>
            ) : null}

            <Typography variant="caption" color="text.secondary" sx={{ mt: 2 }}>
              {S.poweredBy}
            </Typography>
          </Stack>
        ) : null}
      </Container>
    </Box>
  );
}
