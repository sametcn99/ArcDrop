import CallMergeOutlinedIcon from '@mui/icons-material/CallMergeOutlined';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import PublicOutlinedIcon from '@mui/icons-material/PublicOutlined';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
import ViewHeadlineOutlinedIcon from '@mui/icons-material/ViewHeadlineOutlined';
import ViewListOutlinedIcon from '@mui/icons-material/ViewListOutlined';
import Box from '@mui/material/Box';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router';
import type { BookmarkSort } from '../../../api/schemas/bookmarks';
import type { Collection } from '../../../api/schemas/collections';
import { CollectionIcon } from '../../../shared/components/CollectionIcon';
import type { LibraryLayoutMode } from '../../../stores/libraryStore';
import { COLLECTION_PAGE_STRINGS } from '../strings';

export interface CollectionToolbarProps {
  collection: Collection | null;
  ancestors: Collection[];
  sort: BookmarkSort;
  layoutMode: LibraryLayoutMode;
  totalCount: number;
  onSortChange: (sort: BookmarkSort) => void;
  onLayoutChange: (layout: LibraryLayoutMode) => void;
  onShare: () => void;
  onEdit: () => void;
  onMerge: () => void;
  onDelete: () => void;
}

export function CollectionToolbar({
  collection,
  ancestors,
  sort,
  layoutMode,
  totalCount,
  onSortChange,
  onLayoutChange,
  onShare,
  onEdit,
  onMerge,
  onDelete,
}: CollectionToolbarProps) {
  return (
    <Stack spacing={2}>
      <Breadcrumbs aria-label="Collection hierarchy">
        <Link component={RouterLink} to="/" underline="hover" color="inherit" variant="body2">
          {COLLECTION_PAGE_STRINGS.breadcrumbLibrary}
        </Link>
        {ancestors.map((ancestor) => (
          <Link
            key={ancestor.id}
            component={RouterLink}
            to={`/collections/${ancestor.id}`}
            underline="hover"
            color="inherit"
            variant="body2"
          >
            {ancestor.title}
          </Link>
        ))}
        <Typography variant="body2" color="text.primary">
          {collection?.title ?? COLLECTION_PAGE_STRINGS.title}
        </Typography>
      </Breadcrumbs>

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}
      >
        <Box>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <CollectionIcon
              iconName={collection?.icon}
              colorValue={collection?.color}
              fontSize="large"
            />
            <Typography variant="h4" component="h1">
              {collection?.title ?? COLLECTION_PAGE_STRINGS.title}
            </Typography>
            {collection?.share.enabled ? (
              <Chip
                size="small"
                color="primary"
                variant="outlined"
                icon={<PublicOutlinedIcon fontSize="small" />}
                label={COLLECTION_PAGE_STRINGS.sharedChipLabel}
              />
            ) : null}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {`${totalCount} ${COLLECTION_PAGE_STRINGS.countSummarySuffix}`}
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          {collection ? (
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
              <Button
                size="small"
                variant={collection.share.enabled ? 'contained' : 'outlined'}
                startIcon={<ShareOutlinedIcon fontSize="small" />}
                onClick={onShare}
              >
                {COLLECTION_PAGE_STRINGS.shareButtonLabel}
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<EditOutlinedIcon fontSize="small" />}
                onClick={onEdit}
              >
                {COLLECTION_PAGE_STRINGS.editButtonLabel}
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<CallMergeOutlinedIcon fontSize="small" />}
                onClick={onMerge}
              >
                {COLLECTION_PAGE_STRINGS.mergeButtonLabel}
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<DeleteOutlineOutlinedIcon fontSize="small" />}
                onClick={onDelete}
              >
                {COLLECTION_PAGE_STRINGS.deleteButtonLabel}
              </Button>
            </Stack>
          ) : null}

          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel id="collection-sort-label">{COLLECTION_PAGE_STRINGS.sortLabel}</InputLabel>
            <Select
              labelId="collection-sort-label"
              id="collection-sort-select"
              value={sort}
              label={COLLECTION_PAGE_STRINGS.sortLabel}
              onChange={(event) => onSortChange(event.target.value as BookmarkSort)}
            >
              <MenuItem value="updated">{COLLECTION_PAGE_STRINGS.sortUpdated}</MenuItem>
              <MenuItem value="created">{COLLECTION_PAGE_STRINGS.sortCreated}</MenuItem>
              <MenuItem value="title">{COLLECTION_PAGE_STRINGS.sortTitle}</MenuItem>
              <MenuItem value="manual">{COLLECTION_PAGE_STRINGS.sortManual}</MenuItem>
            </Select>
          </FormControl>

          <ToggleButtonGroup
            size="small"
            exclusive
            value={layoutMode}
            aria-label={COLLECTION_PAGE_STRINGS.layoutLabel}
            onChange={(_event, nextMode: LibraryLayoutMode | null) => {
              if (nextMode) {
                onLayoutChange(nextMode);
              }
            }}
          >
            <ToggleButton value="list" aria-label={COLLECTION_PAGE_STRINGS.layoutList}>
              <Tooltip title={COLLECTION_PAGE_STRINGS.layoutList}>
                <ViewListOutlinedIcon fontSize="small" />
              </Tooltip>
            </ToggleButton>
            <ToggleButton value="grid" aria-label={COLLECTION_PAGE_STRINGS.layoutGrid}>
              <Tooltip title={COLLECTION_PAGE_STRINGS.layoutGrid}>
                <GridViewOutlinedIcon fontSize="small" />
              </Tooltip>
            </ToggleButton>
            <ToggleButton value="headlines" aria-label={COLLECTION_PAGE_STRINGS.layoutHeadlines}>
              <Tooltip title={COLLECTION_PAGE_STRINGS.layoutHeadlines}>
                <ViewHeadlineOutlinedIcon fontSize="small" />
              </Tooltip>
            </ToggleButton>
            <ToggleButton value="moodboard" aria-label={COLLECTION_PAGE_STRINGS.layoutMoodboard}>
              <Tooltip title={COLLECTION_PAGE_STRINGS.layoutMoodboard}>
                <DashboardOutlinedIcon fontSize="small" />
              </Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>
        </Stack>
      </Stack>
    </Stack>
  );
}
