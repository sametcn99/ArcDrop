import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import BoltIcon from '@mui/icons-material/Bolt';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import { useEffect, useMemo, useState } from 'react';
import { sendAuthMessage } from '../shared/messages';
import { sendLibraryMessage, type SaveDraft } from '../shared/libraryMessages';
import { errorString, strings } from '../shared/strings';
import { getActiveTabContext, type TabContext } from '../shared/tabContext';
import type { Bookmark, TagUsage } from '../shared/api/bookmarks';
import type { CollectionNode } from '../shared/api/collections';

export interface EditorViewProps {
  baseUrl: string;
  onDisconnected: () => void;
}

const NEW_COLLECTION_ID = '__new-collection__';

interface CollectionOption {
  id: string;
  title: string;
  depth: number;
}

function flattenTree(nodes: CollectionNode[], depth = 0): CollectionOption[] {
  const flat: CollectionOption[] = [];
  for (const node of nodes) {
    flat.push({ id: node.id, title: node.title, depth });
    if (node.children.length > 0) {
      flat.push(...flattenTree(node.children, depth + 1));
    }
  }
  return flat;
}

/**
 * The main popup surface (E2): save/edit the active tab with title,
 * description, tags, collection and favorite — plus quick-save, trash and
 * badge feedback handled by the background library broker.
 */
export function EditorView({ baseUrl, onDisconnected }: EditorViewProps) {
  const [phase, setPhase] = useState<'loading' | 'unsavable' | 'ready'>('loading');
  const [tab, setTab] = useState<TabContext | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [coverRef, setCoverRef] = useState<string | null>(null);
  const [draft, setDraft] = useState<SaveDraft>({
    url: '',
    title: '',
    excerpt: '',
    favorite: false,
    collectionId: null,
    tags: [],
  });
  const [collectionTouched, setCollectionTouched] = useState(false);
  const [options, setOptions] = useState<CollectionOption[] | null>(null);
  const [tagUsage, setTagUsage] = useState<TagUsage[] | null>(null);
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [quickBusy, setQuickBusy] = useState(false);
  const [newCollectionOpen, setNewCollectionOpen] = useState(false);
  const [newCollectionTitle, setNewCollectionTitle] = useState('');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        window.close();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      const activeTab = await getActiveTabContext();
      if (cancelled) return;
      if (!activeTab) {
        setPhase('unsavable');
        return;
      }
      setTab(activeTab);
      setDraft((current) => ({ ...current, url: activeTab.url, title: activeTab.title }));
      setPhase('ready');

      const safe = <T,>(promise: Promise<T>): Promise<T | null> => promise.catch(() => null);

      const [found, tree, usage, meta] = await Promise.all([
        safe(
          sendLibraryMessage({ type: 'library/find-by-url', url: activeTab.url }).then(
            (response) => (response.ok && response.kind === 'found' ? response.bookmark : null),
          ),
        ),
        safe(
          sendLibraryMessage({ type: 'library/collections' }).then((response) =>
            response.ok && response.kind === 'collections' ? response.nodes : null,
          ),
        ),
        safe(
          sendLibraryMessage({ type: 'library/tags' }).then((response) =>
            response.ok && response.kind === 'tags' ? response.usage : null,
          ),
        ),
        safe(
          sendLibraryMessage({ type: 'library/page-meta', tabId: activeTab.tabId }).then(
            (response) => (response.ok && response.kind === 'page-meta' ? response.meta : null),
          ),
        ),
      ]);
      if (cancelled) return;

      setOptions(tree === null ? [] : flattenTree(tree));
      setTagUsage(usage ?? []);

      if (found) {
        setExistingId(found.id);
        setCoverRef(found.coverRef);
        setDraft((current) => ({
          ...current,
          title: found.title ?? current.title,
          excerpt: found.excerpt ?? '',
          favorite: found.favorite,
          tags: found.tags.map((tag) => tag.name),
        }));
      } else if (meta !== null && meta.ogDescription !== null) {
        setDraft((current) => ({ ...current, excerpt: meta.ogDescription ?? '' }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = (): void => {
    if (busy || !tab) {
      return;
    }
    setBusy(true);
    setStatus(null);
    void sendLibraryMessage({
      type: 'library/save',
      draft,
      existingId,
      collectionTouched,
    })
      .then((response) => {
        if (!response.ok) {
          setStatus({ kind: 'error', text: errorString(response.code) });
          return;
        }
        if (response.kind !== 'saved') {
          return;
        }
        const bookmark: Bookmark = response.bookmark;
        setExistingId(bookmark.id);
        setCoverRef(bookmark.coverRef);
        setCollectionTouched(false);
        setStatus({
          kind: 'success',
          text: existingId === null ? strings.popup.savedNew : strings.popup.savedUpdate,
        });
      })
      .catch(() => {
        setStatus({ kind: 'error', text: errorString('NETWORK_ERROR') });
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const trash = (): void => {
    if (busy || existingId === null) {
      return;
    }
    setBusy(true);
    setStatus(null);
    void sendLibraryMessage({ type: 'library/trash', id: existingId })
      .then((response) => {
        if (!response.ok) {
          setStatus({ kind: 'error', text: errorString(response.code) });
          return;
        }
        setExistingId(null);
        setCoverRef(null);
        setDraft((current) => ({ ...current, favorite: false, tags: [], excerpt: '' }));
        setCollectionTouched(true);
        setStatus({ kind: 'success', text: strings.popup.movedToTrash });
      })
      .catch(() => {
        setStatus({ kind: 'error', text: errorString('NETWORK_ERROR') });
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const quickSave = (): void => {
    if (quickBusy) {
      return;
    }
    setQuickBusy(true);
    setStatus(null);
    void sendLibraryMessage({ type: 'library/quick-save' })
      .then((response) => {
        if (!response.ok) {
          setStatus({ kind: 'error', text: errorString(response.code) });
          return;
        }
        if (response.kind !== 'quick-saved') {
          return;
        }
        setStatus({
          kind: 'success',
          text:
            response.result.status === 'already-saved'
              ? strings.popup.quickAlreadySaved
              : strings.popup.quickSaved,
        });
      })
      .catch(() => {
        setStatus({ kind: 'error', text: errorString('NETWORK_ERROR') });
      })
      .finally(() => {
        setQuickBusy(false);
      });
  };

  const createCollection = (): void => {
    const title = newCollectionTitle.trim();
    if (title.length === 0) {
      return;
    }
    setBusy(true);
    void sendLibraryMessage({ type: 'library/create-collection', title, parentId: null })
      .then((response) => {
        if (!response.ok) {
          setStatus({ kind: 'error', text: errorString(response.code) });
          return;
        }
        if (response.kind !== 'collection-created') {
          return;
        }
        const created: CollectionNode = {
          ...response.collection,
          children: [],
        };
        setOptions((current) => [
          ...(current ?? []),
          { id: created.id, title: created.title, depth: 0 },
        ]);
        setDraft((current) => ({ ...current, collectionId: created.id }));
        setCollectionTouched(true);
        setNewCollectionOpen(false);
        setNewCollectionTitle('');
      })
      .catch(() => {
        setStatus({ kind: 'error', text: errorString('NETWORK_ERROR') });
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const disconnect = (): void => {
    void sendAuthMessage({ type: 'auth/disconnect' })
      .then(() => onDisconnected())
      .catch(() => onDisconnected());
  };

  const tagOptions = useMemo(() => (tagUsage ?? []).map((usage) => usage.name), [tagUsage]);

  if (phase === 'loading') {
    return (
      <Stack spacing={1} sx={{ py: 4, alignItems: 'center' }}>
        <CircularProgress size={28} />
        <Typography variant="body2" color="text.secondary">
          {strings.popup.connecting}
        </Typography>
      </Stack>
    );
  }

  if (phase === 'unsavable') {
    return (
      <Stack spacing={1.5}>
        <Typography variant="h6" component="h1">
          {strings.appName}
        </Typography>
        <Alert severity="info">
          {strings.popup.editorLoadFailed} {strings.popup.editorLoadFailedBody}
        </Alert>
        <Button variant="outlined" onClick={() => window.close()}>
          {strings.popup.closeButton}
        </Button>
      </Stack>
    );
  }

  const selectedCollection = options?.find((option) => option.id === draft.collectionId) ?? null;

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="h6" component="h1" sx={{ flex: 1 }}>
          {strings.appName}
        </Typography>
        <Tooltip title={strings.popup.quickSave}>
          <IconButton
            aria-label={strings.popup.quickSave}
            onClick={quickSave}
            disabled={quickBusy}
            size="small"
          >
            {quickBusy ? <CircularProgress size={20} /> : <BoltIcon />}
          </IconButton>
        </Tooltip>
        <Tooltip title={strings.popup.deleteButton}>
          <IconButton
            aria-label={strings.popup.deleteButton}
            onClick={trash}
            disabled={busy || existingId === null}
            size="small"
          >
            <DeleteOutlinedIcon />
          </IconButton>
        </Tooltip>
        <IconButton
          aria-label={strings.appName}
          onClick={() => setDraft((current) => ({ ...current, favorite: !current.favorite }))}
          disabled={busy}
          size="small"
        >
          {draft.favorite ? <FavoriteIcon color="primary" /> : <FavoriteBorderIcon />}
        </IconButton>
      </Stack>

      {status !== null ? (
        <Alert severity={status.kind === 'error' ? 'error' : 'success'}>{status.text}</Alert>
      ) : null}

      {coverRef !== null ? (
        <Box
          component="img"
          src={`${baseUrl}/api/v1/icons/${encodeURIComponent(coverRef)}`}
          alt=""
          sx={{ width: '100%', height: 96, objectFit: 'cover', borderRadius: 2 }}
        />
      ) : null}

      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <Stack spacing={1.5}>
          <TextField
            label={strings.popup.editorTitleField}
            value={draft.title}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            fullWidth
            size="small"
            autoFocus
            disabled={busy}
          />
          <TextField
            label={strings.popup.editorExcerptField}
            value={draft.excerpt}
            onChange={(event) =>
              setDraft((current) => ({ ...current, excerpt: event.target.value }))
            }
            fullWidth
            size="small"
            multiline
            minRows={3}
            disabled={busy}
          />
          {tagUsage === null ? null : (
            <Stack spacing={0.5}>
              <Autocomplete
                multiple
                freeSolo
                options={tagOptions}
                value={draft.tags}
                onChange={(_event, value) =>
                  setDraft((current) => ({ ...current, tags: value as string[] }))
                }
                renderValue={(value, getItemProps) =>
                  value.map((option, index) => {
                    const { key, ...itemProps } = getItemProps({ index });
                    return <Chip key={key} label={option} size="small" {...itemProps} />;
                  })
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={strings.popup.editorTagsField}
                    placeholder={strings.popup.editorTagsPlaceholder}
                    size="small"
                  />
                )}
                disabled={busy}
              />
            </Stack>
          )}
          {options === null ? null : (
            <Autocomplete
              options={[
                ...options,
                { id: NEW_COLLECTION_ID, title: strings.popup.editorCollectionNew, depth: 0 },
              ]}
              value={selectedCollection}
              getOptionLabel={(option) => option.title}
              isOptionEqualToValue={(option, value) => option.id === value.id}
              onChange={(_event, value) => {
                setCollectionTouched(true);
                if (value !== null && value.id === NEW_COLLECTION_ID) {
                  setNewCollectionOpen(true);
                  return;
                }
                setDraft((current) => ({ ...current, collectionId: value?.id ?? null }));
              }}
              renderOption={(props, option) => {
                const { key, ...optionProps } = props;
                return (
                  <Box key={key} component="li" sx={{ pl: 2 + option.depth * 2 }} {...optionProps}>
                    {option.title}
                  </Box>
                );
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={strings.popup.editorCollectionField}
                  placeholder={
                    existingId !== null && !collectionTouched
                      ? strings.popup.editorCollectionKeep
                      : strings.popup.editorCollectionUnsorted
                  }
                  size="small"
                />
              )}
              disabled={busy}
            />
          )}
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? <CircularProgress size={20} /> : strings.popup.saveButton}
          </Button>
        </Stack>
      </Box>

      <Divider />
      <Stack spacing={0.5}>
        <Button variant="outlined" disabled>
          {strings.popup.openApp}
        </Button>
        <Typography variant="caption" color="text.secondary">
          {strings.popup.openAppCaption}
        </Typography>
        <Button
          variant="text"
          onClick={disconnect}
          disabled={busy}
          sx={{ color: 'text.secondary' }}
        >
          {strings.popup.disconnect}
        </Button>
        <Typography variant="caption" color="text.secondary" noWrap>
          {strings.popup.stateLabel}: {baseUrl.replace(/^https?:\/\//, '')}
        </Typography>
      </Stack>

      <Dialog
        open={newCollectionOpen}
        onClose={() => setNewCollectionOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{strings.popup.newCollectionTitle}</DialogTitle>
        <DialogContent>
          <TextField
            label={strings.popup.newCollectionFieldLabel}
            value={newCollectionTitle}
            onChange={(event) => setNewCollectionTitle(event.target.value)}
            fullWidth
            size="small"
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewCollectionOpen(false)} disabled={busy}>
            {strings.popup.cancelButton}
          </Button>
          <Button
            onClick={createCollection}
            variant="contained"
            disabled={busy || newCollectionTitle.trim().length === 0}
          >
            {strings.popup.createButton}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
