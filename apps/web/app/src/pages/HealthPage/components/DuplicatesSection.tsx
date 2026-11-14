import CallMergeOutlinedIcon from '@mui/icons-material/CallMergeOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { useBookmarkDetailNavigationState } from '../../../shared/hooks/useBookmarkDetailNavigationState';
import type { Bookmark, TagSummary } from '../../../api/schemas/bookmarks';
import type { DuplicateGroup, ResolveDuplicatesResponse } from '../../../api/schemas/health';
import { SHARED_BOOKMARK_STRINGS } from '../../../shared/strings';
import { HEALTH_PAGE_STRINGS } from '../strings';

interface DuplicateGroupCardProps {
  group: DuplicateGroup;
  resolving: boolean;
  onResolve: (
    group: DuplicateGroup,
    keepId: string,
    trashIds: string[],
  ) => Promise<ResolveDuplicatesResponse | null>;
}

function DuplicateCandidateCard({
  bookmark,
  isOriginal,
  isKept,
  isTrashed,
  disabled,
  onSelectKeep,
  onToggleTrash,
}: {
  bookmark: Bookmark;
  isOriginal: boolean;
  isKept: boolean;
  isTrashed: boolean;
  disabled: boolean;
  onSelectKeep: () => void;
  onToggleTrash: () => void;
}) {
  const title = bookmark.title ?? bookmark.url ?? SHARED_BOOKMARK_STRINGS.untitledBookmark;
  const detailLinkState = useBookmarkDetailNavigationState();

  return (
    <Card
      variant="outlined"
      data-testid={`dup-candidate-${bookmark.id}`}
      sx={{
        flex: 1,
        borderColor: isKept ? 'primary.main' : 'divider',
        borderWidth: isKept ? 2 : 1,
      }}
    >
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Stack
          direction="row"
          sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
        >
          <Chip
            size="small"
            color={isOriginal ? 'primary' : 'default'}
            variant={isOriginal ? 'filled' : 'outlined'}
            label={
              isOriginal
                ? HEALTH_PAGE_STRINGS.originalBadgeLabel
                : HEALTH_PAGE_STRINGS.extraBadgeLabel
            }
          />
          <Typography variant="caption" color="text.secondary">
            {`${HEALTH_PAGE_STRINGS.createdPrefix}: ${new Date(bookmark.createdAt).toLocaleDateString()}`}
          </Typography>
        </Stack>

        <Link
          component={RouterLink}
          to={`/bookmarks/${bookmark.id}`}
          state={detailLinkState}
          underline="hover"
          color="text.primary"
          variant="subtitle2"
          sx={{ fontWeight: 600 }}
        >
          {title}
        </Link>

        {bookmark.url ? (
          <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
            {bookmark.url}
          </Typography>
        ) : null}

        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
          {bookmark.tags.map((tag) => (
            <Chip key={tag.id} size="small" variant="outlined" label={`#${tag.name}`} />
          ))}
        </Stack>

        <Divider sx={{ my: 0.5 }} />

        <Stack
          direction="row"
          sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}
        >
          <FormControlLabel
            control={
              <Radio size="small" checked={isKept} disabled={disabled} onChange={onSelectKeep} />
            }
            label={<Typography variant="body2">{HEALTH_PAGE_STRINGS.keepRadioLabel}</Typography>}
          />

          {!isKept ? (
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={isTrashed}
                  disabled={disabled}
                  onChange={onToggleTrash}
                />
              }
              label={
                <Typography variant="body2">{HEALTH_PAGE_STRINGS.trashCheckboxLabel}</Typography>
              }
            />
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

function DuplicateGroupCard({ group, resolving, onResolve }: DuplicateGroupCardProps) {
  const candidates = useMemo(() => [group.original, ...group.extras], [group]);
  const [keepId, setKeepId] = useState<string>(group.original.id);
  const [trashIds, setTrashIds] = useState<string[]>(() => group.extras.map((extra) => extra.id));
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSelectKeep = (nextKeepId: string) => {
    setKeepId(nextKeepId);
    setValidationError(null);
    setTrashIds((prev) => {
      const next = prev.filter((id) => id !== nextKeepId);
      if (next.length === 0) {
        return candidates.filter((item) => item.id !== nextKeepId).map((item) => item.id);
      }
      return next;
    });
  };

  const handleToggleTrash = (id: string) => {
    if (id === keepId) return;
    setValidationError(null);
    setTrashIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const mergedTags = useMemo<TagSummary[]>(() => {
    const involvedIds = new Set([keepId, ...trashIds]);
    const seenNames = new Set<string>();
    const result: TagSummary[] = [];
    for (const candidate of candidates) {
      if (!involvedIds.has(candidate.id)) continue;
      for (const tag of candidate.tags) {
        const key = tag.name.trim().toLowerCase();
        if (!key || seenNames.has(key)) continue;
        seenNames.add(key);
        result.push(tag);
      }
    }
    return result;
  }, [candidates, keepId, trashIds]);

  const handleResolveClick = async () => {
    if (trashIds.length === 0) {
      setValidationError(HEALTH_PAGE_STRINGS.resolveNoTrashError);
      return;
    }
    await onResolve(group, keepId, trashIds);
  };

  return (
    <Paper variant="outlined" data-testid={`duplicate-group-${group.normalizedUrl}`} sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary">
              {HEALTH_PAGE_STRINGS.duplicatesGroupPrefix}
            </Typography>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, wordBreak: 'break-all' }}>
              {group.normalizedUrl}
            </Typography>
          </Box>
          <Chip size="small" label={`${candidates.length} bookmarks`} variant="outlined" />
        </Stack>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
            gap: 2,
          }}
        >
          <DuplicateCandidateCard
            bookmark={group.original}
            isOriginal={true}
            isKept={keepId === group.original.id}
            isTrashed={trashIds.includes(group.original.id)}
            disabled={resolving}
            onSelectKeep={() => handleSelectKeep(group.original.id)}
            onToggleTrash={() => handleToggleTrash(group.original.id)}
          />

          <Stack spacing={1.5}>
            {group.extras.map((extra) => (
              <DuplicateCandidateCard
                key={extra.id}
                bookmark={extra}
                isOriginal={false}
                isKept={keepId === extra.id}
                isTrashed={trashIds.includes(extra.id)}
                disabled={resolving}
                onSelectKeep={() => handleSelectKeep(extra.id)}
                onToggleTrash={() => handleToggleTrash(extra.id)}
              />
            ))}
          </Stack>
        </Box>

        <Paper
          variant="outlined"
          data-testid={`dup-preview-${group.normalizedUrl}`}
          sx={{ p: 1.5, bgcolor: 'background.default' }}
        >
          <Stack spacing={1}>
            <Typography variant="subtitle2">{HEALTH_PAGE_STRINGS.mergePreviewHeading}</Typography>
            <Stack
              direction="row"
              spacing={0.75}
              sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.75 }}
            >
              <Typography variant="caption" color="text.secondary">
                {HEALTH_PAGE_STRINGS.mergePreviewTagsLabel}
              </Typography>
              {mergedTags.length === 0 ? (
                <Typography variant="caption" color="text.secondary">
                  {HEALTH_PAGE_STRINGS.mergePreviewNoTags}
                </Typography>
              ) : (
                mergedTags.map((tag) => (
                  <Chip
                    key={tag.id}
                    size="small"
                    color="primary"
                    variant="outlined"
                    label={`#${tag.name}`}
                  />
                ))
              )}
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {HEALTH_PAGE_STRINGS.mergePreviewCollectionsNote}
            </Typography>
          </Stack>
        </Paper>

        {validationError ? <Alert severity="error">{validationError}</Alert> : null}

        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="contained"
            startIcon={<CallMergeOutlinedIcon fontSize="small" />}
            disabled={resolving}
            onClick={() => void handleResolveClick()}
          >
            {resolving
              ? HEALTH_PAGE_STRINGS.resolvingButtonLabel
              : HEALTH_PAGE_STRINGS.resolveButtonLabel}
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
}

export interface DuplicatesSectionProps {
  groups: DuplicateGroup[];
  resolvingUrl: string | null;
  onResolve: (
    group: DuplicateGroup,
    keepId: string,
    trashIds: string[],
  ) => Promise<ResolveDuplicatesResponse | null>;
}

export function DuplicatesSection({ groups, resolvingUrl, onResolve }: DuplicatesSectionProps) {
  if (groups.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }} data-testid="duplicates-empty">
        <Typography variant="h6">{HEALTH_PAGE_STRINGS.duplicatesEmptyTitle}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {HEALTH_PAGE_STRINGS.duplicatesEmptyDescription}
        </Typography>
      </Paper>
    );
  }

  return (
    <Stack spacing={2} data-testid="duplicates-groups-list">
      {groups.map((group) => (
        <DuplicateGroupCard
          key={group.normalizedUrl}
          group={group}
          resolving={resolvingUrl === group.normalizedUrl}
          onResolve={onResolve}
        />
      ))}
    </Stack>
  );
}
