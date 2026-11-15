import BrokenImageOutlinedIcon from '@mui/icons-material/BrokenImageOutlined';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import CancelIcon from '@mui/icons-material/Cancel';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import LanguageOutlinedIcon from '@mui/icons-material/LanguageOutlined';
import LabelOffOutlinedIcon from '@mui/icons-material/LabelOffOutlined';
import StarOutlinedIcon from '@mui/icons-material/StarOutlined';
import UpdateOutlinedIcon from '@mui/icons-material/UpdateOutlined';
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
import {
  cacheStatusSchema,
  contentTypeSchema,
  type BookmarkCacheStatus,
  type BookmarkContentType,
} from '../../api/schemas/bookmarks';
import { selectSortedTags, useLibraryStore } from '../../stores/libraryStore';
import { SHARED_CACHE_STATUS_STRINGS, SHARED_FILTER_STRINGS } from '../strings';
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
  onUpdatedRangeChange: (from: string, to: string) => void;
  onCacheStatusChange: (status: BookmarkCacheStatus | null) => void;
  onDomainChange: (domain: string) => void;
  onMatchOrChange: (enabled: boolean) => void;
  onClearFilters: () => void;
}

function formatCreatedRangeLabel(from: string, to: string): string {
  if (from && to) return `${SHARED_FILTER_STRINGS.chipCreatedPrefix}: ${from} – ${to}`;
  if (from) return `${SHARED_FILTER_STRINGS.chipCreatedPrefix}: >= ${from}`;
  return `${SHARED_FILTER_STRINGS.chipCreatedPrefix}: <= ${to}`;
}

function formatUpdatedRangeLabel(from: string, to: string): string {
  if (from && to) return `${SHARED_FILTER_STRINGS.chipUpdatedPrefix}: ${from} – ${to}`;
  if (from) return `${SHARED_FILTER_STRINGS.chipUpdatedPrefix}: >= ${from}`;
  return `${SHARED_FILTER_STRINGS.chipUpdatedPrefix}: <= ${to}`;
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
  onUpdatedRangeChange,
  onCacheStatusChange,
  onDomainChange,
  onMatchOrChange,
  onClearFilters,
}: FilterChipsBarProps) {
  const [tagInputValue, setTagInputValue] = useState('');
  const [dateAnchor, setDateAnchor] = useState<HTMLElement | null>(null);
  const [draftFrom, setDraftFrom] = useState(filters.createdFrom);
  const [draftTo, setDraftTo] = useState(filters.createdTo);
  const [updatedAnchor, setUpdatedAnchor] = useState<HTMLElement | null>(null);
  const [draftUpdatedFrom, setDraftUpdatedFrom] = useState(filters.updatedFrom ?? '');
  const [draftUpdatedTo, setDraftUpdatedTo] = useState(filters.updatedTo ?? '');
  const [domainAnchor, setDomainAnchor] = useState<HTMLElement | null>(null);
  const [draftDomain, setDraftDomain] = useState(filters.domain ?? '');

  const tagsById = useLibraryStore((s) => s.tagsById);
  const tagOptions = useMemo(() => {
    const selectedSet = new Set(filters.tags.map((t) => t.toLowerCase()));
    return selectSortedTags({ tagsById } as Parameters<typeof selectSortedTags>[0])
      .map((tag) => tag.name)
      .filter((name) => !selectedSet.has(name.toLowerCase()));
  }, [filters.tags, tagsById]);

  const anyActive = hasActiveFilters(filters);
  const dateActive = Boolean(filters.createdFrom || filters.createdTo);
  const updatedDateActive = Boolean(filters.updatedFrom || filters.updatedTo);
  const datePopoverOpen = Boolean(dateAnchor);
  const updatedPopoverOpen = Boolean(updatedAnchor);
  const domainPopoverOpen = Boolean(domainAnchor);

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

        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel id="filter-cache-status-label">
            {SHARED_FILTER_STRINGS.cacheStatusLabel}
          </InputLabel>
          <Select<BookmarkCacheStatus | ''>
            labelId="filter-cache-status-label"
            id="filter-cache-status-select"
            value={filters.cacheStatus ?? ''}
            label={SHARED_FILTER_STRINGS.cacheStatusLabel}
            onChange={(event) => {
              const raw = event.target.value;
              onCacheStatusChange(raw === '' ? null : raw);
            }}
          >
            <MenuItem value="">{SHARED_FILTER_STRINGS.cacheStatusAllOption}</MenuItem>
            {cacheStatusSchema.options.map((statusOption) => (
              <MenuItem key={statusOption} value={statusOption}>
                {SHARED_CACHE_STATUS_STRINGS[statusOption]}
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

        <Button
          size="small"
          variant={updatedDateActive ? 'contained' : 'outlined'}
          startIcon={<UpdateOutlinedIcon fontSize="small" />}
          onClick={(event) => {
            setDraftUpdatedFrom(filters.updatedFrom ?? '');
            setDraftUpdatedTo(filters.updatedTo ?? '');
            setUpdatedAnchor(event.currentTarget);
          }}
          sx={{ textTransform: 'none' }}
        >
          {SHARED_FILTER_STRINGS.updatedButtonLabel}
        </Button>

        <Button
          size="small"
          variant={(filters.domain ?? '') !== '' ? 'contained' : 'outlined'}
          startIcon={<LanguageOutlinedIcon fontSize="small" />}
          onClick={(event) => {
            setDraftDomain(filters.domain ?? '');
            setDomainAnchor(event.currentTarget);
          }}
          sx={{ textTransform: 'none' }}
        >
          {(filters.domain ?? '') !== ''
            ? `${SHARED_FILTER_STRINGS.chipDomainPrefix}: ${filters.domain}`
            : SHARED_FILTER_STRINGS.domainButtonLabel}
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

          {updatedDateActive ? (
            <Chip
              size="small"
              color="primary"
              variant="outlined"
              data-testid="filter-chip-updated"
              label={formatUpdatedRangeLabel(filters.updatedFrom ?? '', filters.updatedTo ?? '')}
              onDelete={() => onUpdatedRangeChange('', '')}
              deleteIcon={
                <CancelIcon
                  aria-label={`${SHARED_FILTER_STRINGS.removeChipLabelPrefix} ${SHARED_FILTER_STRINGS.chipUpdatedPrefix}`}
                />
              }
            />
          ) : null}

          {filters.cacheStatus ? (
            <Chip
              size="small"
              color="primary"
              variant="outlined"
              data-testid="filter-chip-cache-status"
              label={`${SHARED_FILTER_STRINGS.cacheStatusLabel}: ${SHARED_CACHE_STATUS_STRINGS[filters.cacheStatus]}`}
              onDelete={() => onCacheStatusChange(null)}
              deleteIcon={
                <CancelIcon
                  aria-label={`${SHARED_FILTER_STRINGS.removeChipLabelPrefix} ${SHARED_FILTER_STRINGS.cacheStatusLabel}`}
                />
              }
            />
          ) : null}

          {(filters.domain ?? '') !== '' ? (
            <Chip
              size="small"
              color="primary"
              variant="outlined"
              data-testid="filter-chip-domain"
              label={`${SHARED_FILTER_STRINGS.chipDomainPrefix}: ${filters.domain}`}
              onDelete={() => onDomainChange('')}
              deleteIcon={
                <CancelIcon
                  aria-label={`${SHARED_FILTER_STRINGS.removeChipLabelPrefix} ${SHARED_FILTER_STRINGS.chipDomainPrefix}`}
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

      <Popover
        open={updatedPopoverOpen}
        anchorEl={updatedAnchor}
        onClose={() => setUpdatedAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Stack spacing={1.5} sx={{ p: 2, minWidth: 260 }}>
          <Typography variant="subtitle2">{SHARED_FILTER_STRINGS.updatedPopoverTitle}</Typography>
          <TextField
            size="small"
            type="date"
            label={SHARED_FILTER_STRINGS.updatedFromLabel}
            value={draftUpdatedFrom}
            onChange={(event) => setDraftUpdatedFrom(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            size="small"
            type="date"
            label={SHARED_FILTER_STRINGS.updatedToLabel}
            value={draftUpdatedTo}
            onChange={(event) => setDraftUpdatedTo(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
            <Button
              size="small"
              onClick={() => {
                setDraftUpdatedFrom('');
                setDraftUpdatedTo('');
                onUpdatedRangeChange('', '');
                setUpdatedAnchor(null);
              }}
            >
              {SHARED_FILTER_STRINGS.updatedClearLabel}
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={() => {
                onUpdatedRangeChange(draftUpdatedFrom, draftUpdatedTo);
                setUpdatedAnchor(null);
              }}
            >
              {SHARED_FILTER_STRINGS.updatedApplyLabel}
            </Button>
          </Stack>
        </Stack>
      </Popover>

      <Popover
        open={domainPopoverOpen}
        anchorEl={domainAnchor}
        onClose={() => setDomainAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Stack spacing={1.5} sx={{ p: 2, minWidth: 280 }}>
          <Typography variant="subtitle2">{SHARED_FILTER_STRINGS.domainPopoverTitle}</Typography>
          <TextField
            size="small"
            label={SHARED_FILTER_STRINGS.domainFieldLabel}
            value={draftDomain}
            onChange={(event) => setDraftDomain(event.target.value)}
            slotProps={{ htmlInput: { autoComplete: 'off' } }}
            data-testid="filter-domain-input"
          />
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
            <Button
              size="small"
              onClick={() => {
                setDraftDomain('');
                onDomainChange('');
                setDomainAnchor(null);
              }}
            >
              {SHARED_FILTER_STRINGS.domainClearLabel}
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={() => {
                onDomainChange(draftDomain);
                setDomainAnchor(null);
              }}
            >
              {SHARED_FILTER_STRINGS.domainApplyLabel}
            </Button>
          </Stack>
        </Stack>
      </Popover>
    </Stack>
  );
}
