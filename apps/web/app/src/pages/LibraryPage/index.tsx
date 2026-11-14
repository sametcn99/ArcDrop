import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { toggleBookmarkFavoriteAction } from '../../shared/actions/bookmarkActions';
import { BookmarkLayouts } from '../../shared/components/BookmarkLayouts';
import { BulkActionToolbar } from '../../shared/components/BulkActionToolbar';
import { FilterChipsBar } from '../../shared/components/FilterChipsBar';
import { SearchEmptyState } from '../../shared/components/SearchEmptyState';
import { LibraryToolbar } from './components/LibraryToolbar';
import { useLibraryView } from './hooks/useLibraryView';
import { LIBRARY_PAGE_STRINGS } from './strings';

export default function LibraryPage() {
  const {
    scope,
    sort,
    layoutMode,
    filters,
    hasSearchOrFilters,
    searchError,
    setLayoutMode,
    setScope,
    setSort,
    setSearch,
    setType,
    addTag,
    removeTag,
    toggleTag,
    setFavorite,
    setNotag,
    setBroken,
    setFile,
    setCreatedRange,
    setMatchOr,
    clearFilters,
    clearSearchAndFilters,
    items,
    totalCount,
    hasMore,
    loading,
    loadingMore,
    error,
    selectedBookmarkIds,
    toggleBookmarkSelection,
    loadMore,
    retry,
  } = useLibraryView();

  const showPageError = Boolean(error && !searchError);

  return (
    <Stack spacing={3}>
      <LibraryToolbar
        scope={scope}
        sort={sort}
        layoutMode={layoutMode}
        totalCount={totalCount}
        onScopeChange={setScope}
        onSortChange={setSort}
        onLayoutChange={setLayoutMode}
      />

      <FilterChipsBar
        filters={filters}
        onTypeChange={setType}
        onAddTag={addTag}
        onRemoveTag={removeTag}
        onFavoriteChange={setFavorite}
        onNotagChange={setNotag}
        onBrokenChange={setBroken}
        onFileChange={setFile}
        onCreatedRangeChange={setCreatedRange}
        onMatchOrChange={setMatchOr}
        onClearFilters={clearFilters}
      />

      <BulkActionToolbar visibleBookmarkIds={items.map((item) => item.id)} context="library" />

      {showPageError ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={retry}>
              {LIBRARY_PAGE_STRINGS.errorRetryLabel}
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}

      {loading ? (
        <Stack spacing={1.5} data-testid="library-loading">
          <Skeleton variant="rounded" height={96} />
          <Skeleton variant="rounded" height={96} />
          <Skeleton variant="rounded" height={96} />
        </Stack>
      ) : items.length === 0 ? (
        hasSearchOrFilters ? (
          <SearchEmptyState
            onClearSearchAndFilters={clearSearchAndFilters}
            onSelectExample={(example) => setSearch(example)}
          />
        ) : (
          <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="h6">{LIBRARY_PAGE_STRINGS.emptyTitle}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {LIBRARY_PAGE_STRINGS.emptyDescription}
            </Typography>
          </Paper>
        )
      ) : (
        <>
          <BookmarkLayouts
            items={items}
            layoutMode={layoutMode}
            selectedBookmarkIds={selectedBookmarkIds}
            onTagClick={toggleTag}
            onToggleFavorite={(bookmark) => {
              void toggleBookmarkFavoriteAction(bookmark).catch(() => undefined);
            }}
            onToggleSelect={toggleBookmarkSelection}
          />

          {hasMore ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', pt: 1 }}>
              <Button variant="outlined" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore
                  ? LIBRARY_PAGE_STRINGS.loadingMoreLabel
                  : LIBRARY_PAGE_STRINGS.loadMoreLabel}
              </Button>
            </Box>
          ) : null}
        </>
      )}
    </Stack>
  );
}
