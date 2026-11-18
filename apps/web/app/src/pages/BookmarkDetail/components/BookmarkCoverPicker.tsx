import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { setBookmarkCoverRequestSchema } from '../../../api/schemas/bookmarks';
import { BOOKMARK_DETAIL_STRINGS } from '../strings';

export interface BookmarkCoverPickerProps {
  /** File-backed bookmarks cannot receive a cover from a URL. */
  fileBacked: boolean;
  applying: boolean;
  /** Resolves true when the server accepted and stored the new cover. */
  onApply: (imageUrl: string) => Promise<boolean>;
}

/**
 * Cover assignment by URL (plan E8): the web user is not on the bookmark's
 * page, so there is nothing to collect — a validated image URL is enough.
 * The server downloads and stores the image (SSRF pipeline, E7).
 */
export function BookmarkCoverPicker({ fileBacked, applying, onApply }: BookmarkCoverPickerProps) {
  const [url, setUrl] = useState('');
  const [touched, setTouched] = useState(false);

  const parsed = setBookmarkCoverRequestSchema.safeParse({ imageUrl: url.trim() });
  const invalid = touched && !parsed.success;

  const apply = (): void => {
    if (!parsed.success || applying) return;
    void onApply(parsed.data.imageUrl).then((accepted) => {
      if (accepted) {
        setUrl('');
        setTouched(false);
      }
    });
  };

  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">{BOOKMARK_DETAIL_STRINGS.coverSectionLabel}</Typography>
      {fileBacked ? (
        <Typography variant="caption" color="text.secondary">
          {BOOKMARK_DETAIL_STRINGS.coverFileHint}
        </Typography>
      ) : (
        <>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
            <TextField
              size="small"
              fullWidth
              label={BOOKMARK_DETAIL_STRINGS.coverUrlLabel}
              placeholder="https://example.com/lead-image.png"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setTouched(true);
              }}
              error={invalid}
              helperText={invalid ? BOOKMARK_DETAIL_STRINGS.coverInvalidUrlHint : undefined}
              disabled={applying}
            />
            <Button
              variant="outlined"
              onClick={apply}
              disabled={applying || !parsed.success || url.trim().length === 0}
              sx={{ flexShrink: 0, mt: 0.5 }}
            >
              {applying
                ? BOOKMARK_DETAIL_STRINGS.coverApplyingLabel
                : BOOKMARK_DETAIL_STRINGS.coverApplyLabel}
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ mt: -0.5 }}>
            {BOOKMARK_DETAIL_STRINGS.coverFileHint.replace(
              'File-backed bookmarks',
              'The server fetches the URL itself; the browser never contacts the image origin',
            )}
          </Typography>
        </>
      )}
    </Stack>
  );
}
