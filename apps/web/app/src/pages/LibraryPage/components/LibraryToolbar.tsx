import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import ViewHeadlineOutlinedIcon from '@mui/icons-material/ViewHeadlineOutlined';
import ViewListOutlinedIcon from '@mui/icons-material/ViewListOutlined';
import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { BookmarkSort } from '../../../api/schemas/bookmarks';
import type { LibraryLayoutMode, LibraryScope } from '../../../stores/libraryStore';
import { LIBRARY_PAGE_STRINGS } from '../strings';

export interface LibraryToolbarProps {
  scope: LibraryScope;
  sort: BookmarkSort;
  layoutMode: LibraryLayoutMode;
  totalCount: number;
  onScopeChange: (scope: LibraryScope) => void;
  onSortChange: (sort: BookmarkSort) => void;
  onLayoutChange: (layout: LibraryLayoutMode) => void;
}

export function LibraryToolbar({
  scope,
  sort,
  layoutMode,
  totalCount,
  onScopeChange,
  onSortChange,
  onLayoutChange,
}: LibraryToolbarProps) {
  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Box>
          <Typography variant="h4" component="h1">
            {LIBRARY_PAGE_STRINGS.title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {`${totalCount} ${LIBRARY_PAGE_STRINGS.countSummarySuffix}`}
          </Typography>
        </Box>

        <Stack
          direction="row"
          spacing={1.5}
          sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}
        >
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel id="library-sort-label">{LIBRARY_PAGE_STRINGS.sortLabel}</InputLabel>
            <Select
              labelId="library-sort-label"
              id="library-sort-select"
              value={sort}
              label={LIBRARY_PAGE_STRINGS.sortLabel}
              onChange={(event) => onSortChange(event.target.value as BookmarkSort)}
            >
              <MenuItem value="updated">{LIBRARY_PAGE_STRINGS.sortUpdated}</MenuItem>
              <MenuItem value="created">{LIBRARY_PAGE_STRINGS.sortCreated}</MenuItem>
              <MenuItem value="title">{LIBRARY_PAGE_STRINGS.sortTitle}</MenuItem>
            </Select>
          </FormControl>

          <ToggleButtonGroup
            size="small"
            exclusive
            value={layoutMode}
            aria-label={LIBRARY_PAGE_STRINGS.layoutLabel}
            onChange={(_event, nextMode: LibraryLayoutMode | null) => {
              if (nextMode) {
                onLayoutChange(nextMode);
              }
            }}
          >
            <ToggleButton value="list" aria-label={LIBRARY_PAGE_STRINGS.layoutList}>
              <Tooltip title={LIBRARY_PAGE_STRINGS.layoutList}>
                <ViewListOutlinedIcon fontSize="small" />
              </Tooltip>
            </ToggleButton>
            <ToggleButton value="grid" aria-label={LIBRARY_PAGE_STRINGS.layoutGrid}>
              <Tooltip title={LIBRARY_PAGE_STRINGS.layoutGrid}>
                <GridViewOutlinedIcon fontSize="small" />
              </Tooltip>
            </ToggleButton>
            <ToggleButton value="headlines" aria-label={LIBRARY_PAGE_STRINGS.layoutHeadlines}>
              <Tooltip title={LIBRARY_PAGE_STRINGS.layoutHeadlines}>
                <ViewHeadlineOutlinedIcon fontSize="small" />
              </Tooltip>
            </ToggleButton>
            <ToggleButton value="moodboard" aria-label={LIBRARY_PAGE_STRINGS.layoutMoodboard}>
              <Tooltip title={LIBRARY_PAGE_STRINGS.layoutMoodboard}>
                <DashboardOutlinedIcon fontSize="small" />
              </Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>
        </Stack>
      </Stack>

      <Tabs
        value={scope}
        onChange={(_event, nextScope: LibraryScope) => onScopeChange(nextScope)}
        aria-label={LIBRARY_PAGE_STRINGS.scopeLabel}
        variant="scrollable"
        scrollButtons="auto"
      >
        <Tab value="all" label={LIBRARY_PAGE_STRINGS.scopeAll} />
        <Tab value="favorites" label={LIBRARY_PAGE_STRINGS.scopeFavorites} />
        <Tab value="unassigned" label={LIBRARY_PAGE_STRINGS.scopeUnassigned} />
      </Tabs>
    </Stack>
  );
}
