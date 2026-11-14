import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import ReplayOutlinedIcon from '@mui/icons-material/ReplayOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import type { Bookmark, BookmarkArchive } from '../../../api/schemas/bookmarks';
import { CacheStatusChip } from '../../../shared/components/CacheStatusChip';
import { BOOKMARK_DETAIL_STRINGS } from '../strings';

export interface BookmarkArchivePanelProps {
  bookmark: Bookmark;
  archive: BookmarkArchive | null;
  archiveLoading: boolean;
  archiveError: string | null;
  viewMode: 'html' | 'text';
  onViewModeChange: (mode: 'html' | 'text') => void;
  onRefresh: () => void;
  reindexing: boolean;
  onReindex: () => void;
}

export function BookmarkArchivePanel({
  bookmark,
  archive,
  archiveLoading,
  archiveError,
  viewMode,
  onViewModeChange,
  onRefresh,
  reindexing,
  onReindex,
}: BookmarkArchivePanelProps) {
  const isFile = bookmark.storageKind === 'file';
  const isTrashed = bookmark.deletedAt !== null;
  const effectiveStatus = archive?.cacheStatus ?? bookmark.cacheStatus;
  const effectiveCheckedAt = archive?.cacheCheckedAt ?? bookmark.cacheCheckedAt;

  return (
    <Stack spacing={2} data-testid="bookmark-archive-section">
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <CacheStatusChip status={effectiveStatus} />
          {effectiveCheckedAt ? (
            <Typography variant="caption" color="text.secondary">
              {`${BOOKMARK_DETAIL_STRINGS.archiveCheckedAtPrefix}: ${new Date(effectiveCheckedAt).toLocaleString()}`}
            </Typography>
          ) : null}
        </Stack>

        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<RefreshOutlinedIcon fontSize="small" />}
            disabled={archiveLoading}
            onClick={onRefresh}
          >
            {BOOKMARK_DETAIL_STRINGS.archiveRefreshLabel}
          </Button>
          {!isFile ? (
            <Button
              size="small"
              variant="outlined"
              startIcon={<ReplayOutlinedIcon fontSize="small" />}
              disabled={reindexing || isTrashed}
              onClick={onReindex}
            >
              {reindexing
                ? BOOKMARK_DETAIL_STRINGS.archiveReindexingLabel
                : BOOKMARK_DETAIL_STRINGS.archiveReindexLabel}
            </Button>
          ) : null}
        </Stack>
      </Stack>

      {isFile ? (
        <Typography variant="caption" color="text.secondary">
          {BOOKMARK_DETAIL_STRINGS.archiveFileReindexHint}
        </Typography>
      ) : null}

      {effectiveStatus !== 'ready' ? (
        <Alert severity={effectiveStatus === 'failed' ? 'error' : 'info'}>
          {BOOKMARK_DETAIL_STRINGS.cacheStatusDescriptions[effectiveStatus]}
        </Alert>
      ) : (
        <>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={viewMode}
            aria-label={BOOKMARK_DETAIL_STRINGS.archiveHeading}
            onChange={(_event, next: 'html' | 'text' | null) => {
              if (next) onViewModeChange(next);
            }}
          >
            <ToggleButton value="html">{BOOKMARK_DETAIL_STRINGS.archiveViewHtmlLabel}</ToggleButton>
            <ToggleButton value="text">{BOOKMARK_DETAIL_STRINGS.archiveViewTextLabel}</ToggleButton>
          </ToggleButtonGroup>

          {archiveLoading && !archive ? (
            <Stack spacing={1} aria-label={BOOKMARK_DETAIL_STRINGS.archiveLoadingLabel}>
              <Skeleton variant="rounded" height={40} />
              <Skeleton variant="rounded" height={280} />
            </Stack>
          ) : archiveError ? (
            <Alert severity="error">{archiveError}</Alert>
          ) : archive ? (
            viewMode === 'html' ? (
              archive.html.trim().length > 0 ? (
                <Box
                  component="iframe"
                  title={BOOKMARK_DETAIL_STRINGS.archiveIframeTitle}
                  srcDoc={archive.html}
                  sandbox=""
                  data-testid="archive-html-iframe"
                  sx={{
                    width: '100%',
                    minHeight: 420,
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    bgcolor: 'background.paper',
                  }}
                />
              ) : (
                <Alert severity="info">{BOOKMARK_DETAIL_STRINGS.archiveEmptyHtml}</Alert>
              )
            ) : (
              <Paper
                variant="outlined"
                data-testid="archive-text-view"
                sx={{
                  p: 2,
                  bgcolor: 'background.default',
                  maxHeight: 520,
                  overflowY: 'auto',
                }}
              >
                <Typography
                  component="pre"
                  variant="body2"
                  sx={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontFamily: 'inherit',
                    m: 0,
                  }}
                >
                  {archive.text || BOOKMARK_DETAIL_STRINGS.archiveEmptyText}
                </Typography>
              </Paper>
            )
          ) : null}
        </>
      )}
    </Stack>
  );
}
