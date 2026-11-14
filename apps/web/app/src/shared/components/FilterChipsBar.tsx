import BrokenImageOutlinedIcon from '@mui/icons-material/BrokenImageOutlined';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import CancelIcon from '@mui/icons-material/Cancel';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import LabelOffOutlinedIcon from '@mui/icons-material/LabelOffOutlined';
import StarOutlinedIcon from '@mui/icons-material/StarOutlined';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Popover from '@mui/material/Popover';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { contentTypeSchema, type BookmarkContentType } from '../../api/schemas/bookmarks';
import { selectSortedTags, useLibraryStore } from '../../stores/libraryStore';
import { SHARED_FILTER_STRINGS } from '../strings';
import { hasActiveFilters, type BookmarkFilterState } from '../utils/searchFilters';

export interface FilterChipsBarProps {
  filters: BookmarkFilterState;
  onTypeChange: (nextType: BookmarkContentType | null) => void;
  onAddTag: (tagName: string) => void;
  onRemoveTag: (tagName: string) => void;
  onFavoriteChange: (enabled: boolean) => void;
  onNotagChange: (enabled: boolean) => void;
  onBrokenChange: (enabled: boolean) => void;
  onFileChange: (enabled: boolean) => void;
  onCreatedRangeChange: (from: string, to: string) => void;
  onMatchOrChange: (enabled: boolean) => void;
  onClearFilters: () => void;
}

function formatCreatedRangeLabel(from: string, to: string): string {
  if (from && to) return `${SHARED_FILTER_STRINGS.chipCreatedPrefix}: ${from} – ${to}`;
  if (from) return `${SHARED_FILTER_STRINGS.chipCreatedPrefix}: >= ${from}`;
  return `${SHARED_FILTER_STRINGS.chipCreatedPrefix}: <= ${to}`;
}

export function FilterChipsBar({
  filters,
  onTypeChange,
  onAddTag,
  onRemoveTag,
  onFavoriteChange,
  onNotagChange,
  onBrokenChange,
  onFileChange,
  onCreatedRangeChange,
  onMatchOrChange,
  onClearFilters,
}: FilterChipsBarProps) {
  const [tagInputValue, setTagInputValue] = useState('');
  const [dateAnchor, setDateAnchor] = useState<HTMLElement | null>(null);
  const [draftFrom, setDraftFrom] = useState(filters.createdFrom);
  const [draftTo, setDraftTo] = useState(filters.createdTo);

  const tagsById = useLibraryStore((s) => s.tagsById);
  const tagOptions = useMemo(() => {
    const selectedSet = new Set(filters.tags.map((t) => t.toLowerCase()));
    return selectSortedTags({ tagsById } as Parameters<typeof selectSortedTags>[0])
      .map((tag) => tag.name)
      .filter((name) => !selectedSet.has(name.toLowerCase()));
  }, [filters.tags, tagsById]);

  const anyActive = hasActiveFilters(filters);
  const dateActive = Boolean(filters.createdFrom || filters.createdTo);
  const datePopoverOpen = Boolean(dateAnchor);

  return (
    <Stack spacing={1.25} aria-label={SHARED_FILTER_STRINGS.barAriaLabel}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <FormControl size="small" sx={{ minWidth: 132 }}>
          <InputLabel id="filter-type-label">{SHARED_FILTER_STRINGS.typeLabel}</InputLabel>
          <Select<BookmarkContentType | ''>
            labelId="filter-type-label"
            id="filter-type-select"
            value={filters.type ?? ''}
            label={SHARED_FILTER_STRINGS.typeLabel}
            onChange={(event) => {
              const raw = event.target.value;
              onTypeChange(raw === '' ? null : raw);
            }}
          >
            <MenuItem value="">{SHARED_FILTER_STRINGS.typeAllOption}</MenuItem>
            {contentTypeSchema.options.map((typeOption) => (
              <MenuItem key={typeOption} value={typeOption}>
                {SHARED_FILTER_STRINGS.contentTypeLabels[typeOption]}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Box sx={{ minWidth: 185, maxWidth: 240 }}>
          <Autocomplete
            size="small"
            freeSolo
            options={tagOptions}
            value={null}
            inputValue={tagInputValue}
            onInputChange={(_event, nextInput, reason) => {
              if (reason === 'reset') {
                setTagInputValue('');
              } else {
                setTagInputValue(nextInput);
              }
            }}
            onChange={(_event, selected) => {
              if (typeof selected === 'string' && selected.trim() !== '') {
                onAddTag(selected);
                setTagInputValue('');
              }
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label={SHARED_FILTER_STRINGS.tagLabel}
                placeholder={SHARED_FILTER_STRINGS.tagPlaceholder}
              />
            )}
          />
        </Box>

        <ToggleButton
          size="small"
          value="favorite"
          selected={filters.favorite}
          aria-pressed={filters.favorite}
          onChange={() => onFavoriteChange(!filters.favorite)}
          sx={{ textTransform: 'none', gap: 0.5 }}
        >
          <StarOutlinedIcon fontSize="small" />
          {SHARED_FILTER_STRINGS.favoriteLabel}
        </ToggleButton>

        <ToggleButton
          size="small"
          value="notag"
          selected={filters.notag}
          aria-pressed={filters.notag}
          onChange={() => onNotagChange(!filters.notag)}
          sx={{ textTransform: 'none', gap: 0.5 }}
        >
          <LabelOffOutlinedIcon fontSize="small" />
          {SHARED_FILTER_STRINGS.notagLabel}
        </ToggleButton>

        <ToggleButton
          size="small"
          value="broken"
          selected={filters.broken}
          aria-pressed={filters.broken}
          onChange={() => onBrokenChange(!filters.broken)}
          sx={{ textTransform: 'none', gap: 0.5 }}
        >
          <BrokenImageOutlinedIcon fontSize="small" />
          {SHARED_FILTER_STRINGS.brokenLabel}
        </ToggleButton>

        <ToggleButton
          size="small"
          value="file"
          selected={filters.file}
          aria-pressed={filters.file}
          onChange={() => onFileChange(!filters.file)}
          sx={{ textTransform: 'none', gap: 0.5 }}
        >
          <InsertDriveFileOutlinedIcon fontSize="small" />
          {SHARED_FILTER_STRINGS.fileLabel}
        </ToggleButton>

        <Button
          size="small"
          variant={dateActive ? 'contained' : 'outlined'}
          startIcon={<CalendarMonthOutlinedIcon fontSize="small" />}
          onClick={(event) => {
            setDraftFrom(filters.createdFrom);
            setDraftTo(filters.createdTo);
            setDateAnchor(event.currentTarget);
          }}
          sx={{ textTransform: 'none' }}
        >
          {SHARED_FILTER_STRINGS.createdButtonLabel}
        </Button>

        <Tooltip title={SHARED_FILTER_STRINGS.matchOrTooltip}>
          <ToggleButton
            size="small"
            value="matchOr"
            color="primary"
            selected={filters.matchOr}
            aria-label={SHARED_FILTER_STRINGS.matchOrLabel}
            aria-pressed={filters.matchOr}
            onChange={() => onMatchOrChange(!filters.matchOr)}
            sx={{ textTransform: 'none', fontFamily: 'monospace' }}
          >
            {SHARED_FILTER_STRINGS.matchOrLabel}
          </ToggleButton>
        </Tooltip>

        {anyActive ? (
          <Button size="small" variant="text" onClick={onClearFilters}>
            {SHARED_FILTER_STRINGS.clearFiltersLabel}
          </Button>
        ) : null}
      </Stack>

      {anyActive ? (
        <Stack
          direction="row"
          spacing={0.75}
          data-testid="active-filter-chips"
          sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.75 }}
        >
          {filters.type ? (
            <Chip
              size="small"
              color="primary"
              variant="outlined"
              data-testid="filter-chip-type"
              label={`${SHARED_FILTER_STRINGS.chipTypePrefix}: ${filters.type}`}
              onDelete={() => onTypeChange(null)}
              deleteIcon={
                <CancelIcon
                  aria-label={`${SHARED_FILTER_STRINGS.removeChipLabelPrefix} ${SHARED_FILTER_STRINGS.chipTypePrefix}`}
                />
              }
            />
          ) : null}

          {filters.tags.map((tagName) => (
            <Chip
              key={tagName}
              size="small"
              color="primary"
              variant="outlined"
              data-testid={`filter-chip-tag-${tagName}`}
              label={`#${tagName}`}
              onDelete={() => onRemoveTag(tagName)}
              deleteIcon={
                <CancelIcon
                  aria-label={`${SHARED_FILTER_STRINGS.removeChipLabelPrefix} #${tagName}`}
                />
              }
            />
          ))}

          {filters.favorite ? (
            <Chip
              size="small"
              color="primary"
              variant="outlined"
              data-testid="filter-chip-favorite"
              label={SHARED_FILTER_STRINGS.chipFavorite}
              onDelete={() => onFavoriteChange(false)}
              deleteIcon={
                <CancelIcon
                  aria-label={`${SHARED_FILTER_STRINGS.removeChipLabelPrefix} ${SHARED_FILTER_STRINGS.chipFavorite}`}
                />
              }
            />
          ) : null}

          {filters.notag ? (
            <Chip
              size="small"
              color="primary"
              variant="outlined"
              data-testid="filter-chip-notag"
              label={SHARED_FILTER_STRINGS.chipNotag}
              onDelete={() => onNotagChange(false)}
              deleteIcon={
                <CancelIcon
                  aria-label={`${SHARED_FILTER_STRINGS.removeChipLabelPrefix} ${SHARED_FILTER_STRINGS.chipNotag}`}
                />
              }
            />
          ) : null}

          {filters.broken ? (
            <Chip
              size="small"
              color="primary"
              variant="outlined"
              data-testid="filter-chip-broken"
              label={SHARED_FILTER_STRINGS.chipBroken}
              onDelete={() => onBrokenChange(false)}
              deleteIcon={
                <CancelIcon
                  aria-label={`${SHARED_FILTER_STRINGS.removeChipLabelPrefix} ${SHARED_FILTER_STRINGS.chipBroken}`}
                />
              }
            />
          ) : null}

          {filters.file ? (
            <Chip
              size="small"
              color="primary"
              variant="outlined"
              data-testid="filter-chip-file"
              label={SHARED_FILTER_STRINGS.chipFile}
              onDelete={() => onFileChange(false)}
              deleteIcon={
                <CancelIcon
                  aria-label={`${SHARED_FILTER_STRINGS.removeChipLabelPrefix} ${SHARED_FILTER_STRINGS.chipFile}`}
                />
              }
            />
          ) : null}

          {dateActive ? (
            <Chip
              size="small"
              color="primary"
              variant="outlined"
              data-testid="filter-chip-created"
              label={formatCreatedRangeLabel(filters.createdFrom, filters.createdTo)}
              onDelete={() => onCreatedRangeChange('', '')}
              deleteIcon={
                <CancelIcon
                  aria-label={`${SHARED_FILTER_STRINGS.removeChipLabelPrefix} ${SHARED_FILTER_STRINGS.chipCreatedPrefix}`}
                />
              }
            />
          ) : null}

          {filters.matchOr ? (
            <Chip
              size="small"
              color="secondary"
              variant="outlined"
              data-testid="filter-chip-match-or"
              label={SHARED_FILTER_STRINGS.chipMatchOr}
              onDelete={() => onMatchOrChange(false)}
              deleteIcon={
                <CancelIcon
                  aria-label={`${SHARED_FILTER_STRINGS.removeChipLabelPrefix} ${SHARED_FILTER_STRINGS.chipMatchOr}`}
                />
              }
            />
          ) : null}
        </Stack>
      ) : null}

      <Popover
        open={datePopoverOpen}
        anchorEl={dateAnchor}
        onClose={() => setDateAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Stack spacing={1.5} sx={{ p: 2, minWidth: 260 }}>
          <Typography variant="subtitle2">{SHARED_FILTER_STRINGS.createdPopoverTitle}</Typography>
          <TextField
            size="small"
            type="date"
            label={SHARED_FILTER_STRINGS.createdFromLabel}
            value={draftFrom}
            onChange={(event) => setDraftFrom(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            size="small"
            type="date"
            label={SHARED_FILTER_STRINGS.createdToLabel}
            value={draftTo}
            onChange={(event) => setDraftTo(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
            <Button
              size="small"
              onClick={() => {
                setDraftFrom('');
                setDraftTo('');
                onCreatedRangeChange('', '');
                setDateAnchor(null);
              }}
            >
              {SHARED_FILTER_STRINGS.createdClearLabel}
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={() => {
                onCreatedRangeChange(draftFrom, draftTo);
                setDateAnchor(null);
              }}
            >
              {SHARED_FILTER_STRINGS.createdApplyLabel}
            </Button>
          </Stack>
        </Stack>
      </Popover>
    </Stack>
  );
}
