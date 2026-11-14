import OpenInNewOutlinedIcon from '@mui/icons-material/OpenInNewOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router';
import type { Bookmark } from '../../../api/schemas/bookmarks';
import type { BrokenLinkCheckMode } from '../../../api/schemas/settings';
import { CacheStatusChip } from '../../../shared/components/CacheStatusChip';
import { SHARED_BOOKMARK_STRINGS } from '../../../shared/strings';
import { HEALTH_PAGE_STRINGS } from '../strings';

export interface BrokenLinksSectionProps {
  items: Bookmark[];
  checkMode: BrokenLinkCheckMode;
  modeFromSettings: boolean;
  recheckingId: string | null;
  onRecheck: (bookmarkId: string) => Promise<void>;
}

export function BrokenLinksSection({
  items,
  checkMode,
  modeFromSettings,
  recheckingId,
  onRecheck,
}: BrokenLinksSectionProps) {
  return (
    <Stack spacing={2}>
      <Alert severity="info" data-testid="broken-links-mode-note">
        {`${HEALTH_PAGE_STRINGS.modeNotePrefix} ${checkMode} — ${HEALTH_PAGE_STRINGS.modeDescriptions[checkMode]} (${
          modeFromSettings
            ? HEALTH_PAGE_STRINGS.modeAdminSource
            : HEALTH_PAGE_STRINGS.modeDefaultSource
        })`}
      </Alert>

      {items.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }} data-testid="broken-links-empty">
          <Typography variant="h6">{HEALTH_PAGE_STRINGS.brokenEmptyTitle}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {HEALTH_PAGE_STRINGS.brokenEmptyDescription}
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={1.5} data-testid="broken-links-list">
          {items.map((bookmark) => {
            const title =
              bookmark.title ?? bookmark.url ?? SHARED_BOOKMARK_STRINGS.untitledBookmark;
            const isRechecking = recheckingId === bookmark.id;

            return (
              <Card
                key={bookmark.id}
                variant="outlined"
                data-testid={`broken-bookmark-${bookmark.id}`}
              >
                <CardContent sx={{ py: 1.75, '&:last-child': { pb: 1.75 } }}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1.5}
                    sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
                  >
                    <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                      <Link
                        component={RouterLink}
                        to={`/bookmarks/${bookmark.id}`}
                        underline="hover"
                        color="text.primary"
                        variant="subtitle1"
                        sx={{ fontWeight: 600, display: 'block' }}
                      >
                        {title}
                      </Link>
                      {bookmark.url ? (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: 'block', wordBreak: 'break-all' }}
                        >
                          {bookmark.url}
                        </Typography>
                      ) : null}

                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ mt: 1, alignItems: 'center', flexWrap: 'wrap', gap: 0.75 }}
                      >
                        <Chip
                          size="small"
                          color="error"
                          variant="outlined"
                          label={`${HEALTH_PAGE_STRINGS.brokenReasonLabel}: ${
                            bookmark.brokenReason ?? HEALTH_PAGE_STRINGS.brokenReasonUnknown
                          }`}
                        />
                        <CacheStatusChip status={bookmark.cacheStatus} />
                        {bookmark.brokenAt ? (
                          <Typography variant="caption" color="text.secondary">
                            {`${HEALTH_PAGE_STRINGS.brokenAtPrefix}: ${new Date(
                              bookmark.brokenAt,
                            ).toLocaleDateString()}`}
                          </Typography>
                        ) : null}
                        <Typography variant="caption" color="text.secondary">
                          {`${HEALTH_PAGE_STRINGS.lastCheckedPrefix}: ${
                            bookmark.lastCheckedAt
                              ? new Date(bookmark.lastCheckedAt).toLocaleDateString()
                              : HEALTH_PAGE_STRINGS.neverCheckedLabel
                          }`}
                        </Typography>
                      </Stack>
                    </Box>

                    <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<RefreshOutlinedIcon fontSize="small" />}
                        disabled={isRechecking}
                        aria-label={`${HEALTH_PAGE_STRINGS.recheckButtonLabel}: ${title}`}
                        onClick={() => void onRecheck(bookmark.id)}
                      >
                        {isRechecking
                          ? HEALTH_PAGE_STRINGS.recheckScheduledLabel
                          : HEALTH_PAGE_STRINGS.recheckButtonLabel}
                      </Button>
                      <Button
                        size="small"
                        component={RouterLink}
                        to={`/bookmarks/${bookmark.id}`}
                        endIcon={<OpenInNewOutlinedIcon fontSize="small" />}
                      >
                        {HEALTH_PAGE_STRINGS.openDetailsLabel}
                      </Button>
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
