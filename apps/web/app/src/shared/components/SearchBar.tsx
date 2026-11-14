import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined';
import HelpOutlineOutlinedIcon from '@mui/icons-material/HelpOutlineOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Paper from '@mui/material/Paper';
import Popper from '@mui/material/Popper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import {
  selectSortedTags,
  useLibraryStore,
  type SearchErrorState,
} from '../../stores/libraryStore';
import { SHARED_SEARCH_STRINGS } from '../strings';
import { formatSearchTagToken } from '../utils/searchFilters';

const SEARCH_DEBOUNCE_MS = 250;

function formatFriendlySearchError(searchError: SearchErrorState): string {
  const detail = searchError.detail.trim();
  if (
    searchError.code === 'RESERVED_OPERATOR' ||
    /not available yet|planned for|reserved/i.test(detail)
  ) {
    return `${detail} — ${SHARED_SEARCH_STRINGS.reservedOperatorHint}`;
  }
  if (/unknown search operator/i.test(detail)) {
    return `${detail} — ${SHARED_SEARCH_STRINGS.unknownOperatorHint}`;
  }
  return detail;
}

function isSearchableRoute(pathname: string): boolean {
  return pathname === '/' || pathname.startsWith('/collections/');
}

export function SearchBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSearch = (searchParams.get('search') ?? '').trim();

  const [inputValue, setInputValue] = useState(urlSearch);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<HTMLDivElement | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommittedRef = useRef(urlSearch);

  const tagsById = useLibraryStore((s) => s.tagsById);
  const searchError = useLibraryStore((s) => s.searchError);
  const clearSearchError = useLibraryStore((s) => s.clearSearchError);

  const sortedTags = useMemo(
    () => selectSortedTags({ tagsById } as Parameters<typeof selectSortedTags>[0]),
    [tagsById],
  );

  // Sync external URL changes (back/forward, tag click, clear all) into local input state.
  useEffect(() => {
    if (urlSearch !== lastCommittedRef.current) {
      lastCommittedRef.current = urlSearch;
      setInputValue(urlSearch);
    }
  }, [urlSearch]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const commitSearch = useCallback(
    (rawValue: string) => {
      const trimmed = rawValue.trim();
      lastCommittedRef.current = trimmed;

      if (isSearchableRoute(location.pathname)) {
        setSearchParams((prev) => {
          const current = (prev.get('search') ?? '').trim();
          if (current === trimmed) {
            return prev;
          }
          const next = new URLSearchParams(prev);
          if (trimmed === '') {
            next.delete('search');
          } else {
            next.set('search', trimmed);
          }
          return next;
        });
        return;
      }

      if (trimmed !== '') {
        navigate(`/?search=${encodeURIComponent(trimmed)}`);
      }
    },
    [location.pathname, navigate, setSearchParams],
  );

  const cancelDebounce = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const handleInputChange = (nextValue: string) => {
    setInputValue(nextValue);
    clearSearchError();
    cancelDebounce();
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      commitSearch(nextValue);
    }, SEARCH_DEBOUNCE_MS);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    cancelDebounce();
    clearSearchError();
    commitSearch(inputValue);
    setPopoverOpen(false);
  };

  const handleClear = () => {
    cancelDebounce();
    clearSearchError();
    setInputValue('');
    commitSearch('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      setPopoverOpen(false);
    }
  };

  const tagMatch = useMemo(() => {
    const match = /(?:^|\s)#([^\s"]*)$/.exec(inputValue);
    if (!match) return null;
    const prefix = (match[1] ?? '').toLowerCase();
    const startIndex = inputValue.length - (match[1]?.length ?? 0) - 1;
    return { prefix, startIndex };
  }, [inputValue]);

  const matchingTags = useMemo(() => {
    if (!tagMatch) return [];
    return sortedTags.filter((tag) => tag.name.toLowerCase().includes(tagMatch.prefix)).slice(0, 6);
  }, [sortedTags, tagMatch]);

  const insertToken = (token: string, replaceTrailingTagPrefix = false) => {
    cancelDebounce();
    clearSearchError();
    let nextValue: string;
    if (replaceTrailingTagPrefix && tagMatch) {
      const before = inputValue.slice(0, tagMatch.startIndex);
      nextValue = `${before}${token} `;
    } else {
      const trimmed = inputValue.trimEnd();
      nextValue = trimmed === '' ? `${token} ` : `${trimmed} ${token} `;
    }
    setInputValue(nextValue);
    commitSearch(nextValue);
    inputRef.current?.focus();
  };

  const showError = Boolean(searchError);

  return (
    <ClickAwayListener onClickAway={() => setPopoverOpen(false)}>
      <Box
        ref={setAnchorEl}
        onKeyDown={handleKeyDown}
        sx={{ position: 'relative', flexGrow: 1, maxWidth: 480 }}
      >
        <Box component="form" onSubmit={handleSubmit}>
          <TextField
            size="small"
            fullWidth
            inputRef={inputRef}
            value={inputValue}
            error={showError}
            placeholder={SHARED_SEARCH_STRINGS.placeholder}
            onFocus={() => setPopoverOpen(true)}
            onChange={(event) => handleInputChange(event.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchOutlinedIcon fontSize="small" />
                  </InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    {inputValue ? (
                      <Tooltip title={SHARED_SEARCH_STRINGS.clearLabel}>
                        <IconButton
                          size="small"
                          aria-label={SHARED_SEARCH_STRINGS.clearLabel}
                          onClick={handleClear}
                        >
                          <CloseOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    ) : null}
                    <Tooltip title={SHARED_SEARCH_STRINGS.helpButtonLabel}>
                      <IconButton
                        size="small"
                        aria-label={SHARED_SEARCH_STRINGS.helpButtonLabel}
                        aria-expanded={popoverOpen}
                        onClick={() => setPopoverOpen((prev) => !prev)}
                      >
                        <HelpOutlineOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ),
              },
              htmlInput: {
                'aria-label': SHARED_SEARCH_STRINGS.ariaLabel,
                'aria-invalid': showError || undefined,
                'aria-describedby': showError ? 'search-inline-error' : undefined,
              },
            }}
          />
        </Box>

        {searchError ? (
          <Paper
            elevation={4}
            sx={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              right: 0,
              zIndex: (theme) => theme.zIndex.modal + 1,
            }}
          >
            <Alert
              id="search-inline-error"
              severity="error"
              data-testid="search-inline-error"
              onClose={() => clearSearchError()}
            >
              {formatFriendlySearchError(searchError)}
            </Alert>
          </Paper>
        ) : null}

        <Popper
          open={popoverOpen && Boolean(anchorEl)}
          anchorEl={anchorEl}
          placement="bottom-start"
          disablePortal
          sx={{
            zIndex: (theme) => theme.zIndex.modal,
            width: 440,
            maxWidth: '90vw',
            pt: searchError ? 7 : 0.75,
          }}
        >
          <Paper
            elevation={6}
            variant="outlined"
            data-testid="search-cheatsheet-popover"
            sx={{ p: 2, maxHeight: 420, overflowY: 'auto' }}
          >
            <Stack spacing={1.5}>
              {matchingTags.length > 0 ? (
                <>
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                      {SHARED_SEARCH_STRINGS.tagSuggestionsHeading}
                    </Typography>
                    <Stack
                      direction="row"
                      spacing={0.5}
                      sx={{ mt: 0.75, flexWrap: 'wrap', gap: 0.5 }}
                    >
                      {matchingTags.map((tag) => (
                        <Chip
                          key={tag.id}
                          size="small"
                          color="primary"
                          variant="outlined"
                          label={`#${tag.name} (${tag.count})`}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => insertToken(formatSearchTagToken(tag.name), true)}
                        />
                      ))}
                    </Stack>
                  </Box>
                  <Divider />
                </>
              ) : null}

              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="subtitle2">{SHARED_SEARCH_STRINGS.cheatsheetTitle}</Typography>
                <IconButton
                  size="small"
                  aria-label={SHARED_SEARCH_STRINGS.closeCheatsheetLabel}
                  onClick={() => setPopoverOpen(false)}
                >
                  <CloseOutlinedIcon fontSize="small" />
                </IconButton>
              </Stack>

              <Typography variant="caption" color="text.secondary">
                {SHARED_SEARCH_STRINGS.cheatsheetSubtitle}
              </Typography>

              <Stack spacing={1.25}>
                {SHARED_SEARCH_STRINGS.cheatsheetGroups.map((group) => (
                  <Box key={group.label}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                      {group.label}
                    </Typography>
                    <Stack
                      direction="row"
                      spacing={0.5}
                      sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.5 }}
                    >
                      {group.examples.map((example) => (
                        <Chip
                          key={example}
                          size="small"
                          variant="outlined"
                          label={example}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => insertToken(example)}
                          sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                        />
                      ))}
                    </Stack>
                  </Box>
                ))}
              </Stack>
            </Stack>
          </Paper>
        </Popper>
      </Box>
    </ClickAwayListener>
  );
}
