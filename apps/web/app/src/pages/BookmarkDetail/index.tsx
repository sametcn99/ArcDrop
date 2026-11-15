import CloseIcon from '@mui/icons-material/Close';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { useEffect } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams, type Location } from 'react-router';
import { bookmarksApi } from '../../api/endpoints/bookmarks';
import { BookmarkArchivePanel } from './components/BookmarkArchivePanel';
import { BookmarkDetailForm } from './components/BookmarkDetailForm';
import { useBookmarkDetail } from './hooks/useBookmarkDetail';
import { BOOKMARK_DETAIL_STRINGS } from './strings';

export default function BookmarkDetailPage() {
  const { bookmarkId } = useParams<{ bookmarkId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // When opened from a list (background-location pattern), closing pops back
  // to that list; direct URL loads fall back to the library root.
  const hasBackground = Boolean((location.state as { background?: Location } | null)?.background);

  const activeTab = searchParams.get('tab') === 'archive' ? 'archive' : 'details';
  const archiveView = searchParams.get('view') === 'text' ? 'text' : 'html';

  const {
    bookmark,
    loading,
    loadError,
    saving,
    saveError,
    fieldErrors,
    form,
    isDirty,
    setField,
    resetEdits,
    save,
    tagsSaving,
    tagsError,
    saveTags,
    reminderSaving,
    reminderError,
    saveReminder,
    highlights,
    highlightsLoading,
    highlightsBusy,
    highlightsError,
    createHighlight,
    updateHighlight,
    deleteHighlight,
    toggleFavorite,
    trash,
    restore,
    archive,
    archiveLoading,
    archiveError,
    reindexing,
    loadArchive,
    refreshArchiveStatus,
    reindex,
    downloadFile,
  } = useBookmarkDetail(bookmarkId);

  useEffect(() => {
    if (
      activeTab === 'archive' &&
      bookmark &&
      bookmark.cacheStatus === 'ready' &&
      !archive &&
      !archiveLoading &&
      !archiveError
    ) {
      void loadArchive();
    }
  }, [activeTab, archive, archiveError, archiveLoading, bookmark, loadArchive]);

  const handleTabChange = (nextTab: 'details' | 'archive', nextView?: 'html' | 'text') => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (nextTab === 'details') {
          next.delete('tab');
          next.delete('view');
        } else {
          next.set('tab', 'archive');
          if (nextView) {
            next.set('view', nextView);
          }
        }
        return next;
      },
      { replace: true },
    );
  };

  const handleArchiveViewChange = (nextView: 'html' | 'text') => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', 'archive');
        next.set('view', nextView);
        return next;
      },
      { replace: true },
    );
  };

  const handleClose = () => {
    if (hasBackground) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  const handleTrash = async () => {
    const ok = await trash();
    if (ok) {
      if (hasBackground) {
        navigate(-1);
      } else {
        navigate('/');
      }
    }
  };

  return (
    <Drawer
      anchor="right"
      open
      onClose={handleClose}
      slotProps={{
        paper: {
          sx: {
            width: { xs: '100%', sm: 560, md: 640 },
            maxWidth: '100%',
          },
        },
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Stack
          direction="row"
          sx={{
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 3,
            py: 2,
          }}
        >
          <Typography variant="h6" component="h1">
            {BOOKMARK_DETAIL_STRINGS.title}
          </Typography>
          <IconButton aria-label={BOOKMARK_DETAIL_STRINGS.closeLabel} onClick={handleClose}>
            <CloseIcon />
          </IconButton>
        </Stack>

        <Divider />

        {bookmark ? (
          <>
            <Tabs
              value={activeTab}
              onChange={(_event, value: 'details' | 'archive') => handleTabChange(value)}
              aria-label={BOOKMARK_DETAIL_STRINGS.title}
              sx={{ px: 3, flexShrink: 0 }}
            >
              <Tab
                value="details"
                label={BOOKMARK_DETAIL_STRINGS.detailsTabLabel}
                data-testid="bookmark-detail-tab-details"
              />
              <Tab
                value="archive"
                label={BOOKMARK_DETAIL_STRINGS.archiveTabLabel}
                data-testid="bookmark-detail-tab-archive"
              />
            </Tabs>
            <Divider />
          </>
        ) : null}

        <Box sx={{ p: 3, overflowY: 'auto', flexGrow: 1 }}>
          {loading && !bookmark ? (
            <Stack spacing={2} aria-label={BOOKMARK_DETAIL_STRINGS.loadingLabel}>
              <Skeleton variant="rounded" height={48} />
              <Skeleton variant="rounded" height={56} />
              <Skeleton variant="rounded" height={96} />
            </Stack>
          ) : loadError ? (
            <Stack spacing={2}>
              <Alert severity="error">{loadError}</Alert>
              <Button variant="outlined" onClick={handleClose}>
                {BOOKMARK_DETAIL_STRINGS.backToLibraryLabel}
              </Button>
            </Stack>
          ) : !bookmark ? (
            <Stack spacing={2}>
              <Typography variant="h6">{BOOKMARK_DETAIL_STRINGS.notFoundTitle}</Typography>
              <Typography variant="body2" color="text.secondary">
                {BOOKMARK_DETAIL_STRINGS.notFoundDescription}
              </Typography>
              <Button variant="outlined" onClick={handleClose}>
                {BOOKMARK_DETAIL_STRINGS.backToLibraryLabel}
              </Button>
            </Stack>
          ) : activeTab === 'archive' ? (
            <BookmarkArchivePanel
              bookmark={bookmark}
              archive={archive}
              archiveLoading={archiveLoading}
              archiveError={archiveError}
              viewMode={archiveView}
              onViewModeChange={handleArchiveViewChange}
              onRefresh={() => void refreshArchiveStatus()}
              reindexing={reindexing}
              onReindex={() => void reindex()}
            />
          ) : (
            <>
              {bookmark.coverRef ? (
                <Box
                  component="img"
                  src={bookmarksApi.coverUrl(bookmark.coverRef)}
                  alt=""
                  loading="lazy"
                  sx={{
                    width: '100%',
                    maxHeight: 180,
                    objectFit: 'cover',
                    borderRadius: 1,
                    mb: 2,
                    display: 'block',
                  }}
                  data-testid="bookmark-detail-cover"
                />
              ) : null}
              <BookmarkDetailForm
                bookmark={bookmark}
                form={form}
                fieldErrors={fieldErrors}
                saveError={saveError}
                saving={saving}
                isDirty={isDirty}
                onFieldChange={setField}
                onReset={resetEdits}
                onSave={save}
                tagsSaving={tagsSaving}
                tagsError={tagsError}
                onSaveTags={saveTags}
                reminderSaving={reminderSaving}
                reminderError={reminderError}
                onSaveReminder={saveReminder}
                highlights={highlights}
                highlightsLoading={highlightsLoading}
                highlightsBusy={highlightsBusy}
                highlightsError={highlightsError}
                onCreateHighlight={createHighlight}
                onUpdateHighlight={updateHighlight}
                onDeleteHighlight={deleteHighlight}
                onToggleFavorite={() => void toggleFavorite()}
                onTrash={() => void handleTrash()}
                onRestore={() => void restore()}
                onDownloadFile={() => void downloadFile()}
                onOpenArchiveText={() => handleTabChange('archive', 'text')}
              />
            </>
          )}
        </Box>
      </Box>
    </Drawer>
  );
}
