import CloseIcon from '@mui/icons-material/Close';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useNavigate, useParams } from 'react-router';
import { BookmarkDetailForm } from './components/BookmarkDetailForm';
import { useBookmarkDetail } from './hooks/useBookmarkDetail';
import { BOOKMARK_DETAIL_STRINGS } from './strings';

export default function BookmarkDetailPage() {
  const { bookmarkId } = useParams<{ bookmarkId: string }>();
  const navigate = useNavigate();
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
    toggleFavorite,
    trash,
    restore,
  } = useBookmarkDetail(bookmarkId);

  const handleClose = () => {
    navigate('/');
  };

  const handleTrash = async () => {
    const ok = await trash();
    if (ok) {
      navigate('/');
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
            width: { xs: '100%', sm: 460 },
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
          ) : (
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
              onToggleFavorite={() => void toggleFavorite()}
              onTrash={() => void handleTrash()}
              onRestore={() => void restore()}
            />
          )}
        </Box>
      </Box>
    </Drawer>
  );
}
