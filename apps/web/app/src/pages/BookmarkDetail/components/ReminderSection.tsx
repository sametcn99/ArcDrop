import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import dayjs, { type Dayjs } from 'dayjs';
import { useState } from 'react';
import { BOOKMARK_DETAIL_STRINGS } from '../strings';

export interface ReminderSectionProps {
  reminderAt: string | null;
  remindedAt: string | null;
  busy: boolean;
  error: string | null;
  isTrashed: boolean;
  onSaveReminder: (nextReminderAt: string | null) => Promise<boolean>;
}

export function ReminderSection({
  reminderAt,
  remindedAt,
  busy,
  error,
  isTrashed,
  onSaveReminder,
}: ReminderSectionProps) {
  const [draftState, setDraftState] = useState<{
    baseReminderAt: string | null;
    value: Dayjs | null;
  } | null>(null);

  const draftValue =
    draftState && draftState.baseReminderAt === reminderAt
      ? draftState.value
      : reminderAt
        ? dayjs(reminderAt)
        : null;

  const isValidDraft = Boolean(draftValue && draftValue.isValid());
  const draftIso = isValidDraft && draftValue ? draftValue.toISOString() : null;
  const hasChanged = draftIso !== reminderAt;

  return (
    <Stack spacing={1.25} data-testid="bookmark-reminder-section">
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
        <NotificationsActiveOutlinedIcon fontSize="small" color="action" />
        <Typography variant="subtitle2">{BOOKMARK_DETAIL_STRINGS.reminderHeading}</Typography>
      </Stack>

      {error ? <Alert severity="error">{error}</Alert> : null}

      <DateTimePicker
        label={BOOKMARK_DETAIL_STRINGS.reminderPickerLabel}
        value={draftValue}
        disabled={busy || isTrashed}
        onChange={(nextValue) => setDraftState({ baseReminderAt: reminderAt, value: nextValue })}
        slotProps={{
          textField: {
            size: 'small',
            fullWidth: true,
            helperText: isTrashed ? BOOKMARK_DETAIL_STRINGS.reminderTrashedHint : undefined,
          },
        }}
      />

      {remindedAt ? (
        <Typography variant="caption" color="warning.main">
          {`${BOOKMARK_DETAIL_STRINGS.reminderStatusDue}: ${new Date(remindedAt).toLocaleString()}`}
        </Typography>
      ) : reminderAt ? (
        <Typography variant="caption" color="text.secondary">
          {`${BOOKMARK_DETAIL_STRINGS.reminderStatusScheduled}: ${new Date(
            reminderAt,
          ).toLocaleString()}`}
        </Typography>
      ) : (
        <Typography variant="caption" color="text.secondary">
          {BOOKMARK_DETAIL_STRINGS.reminderNone}
        </Typography>
      )}

      {!isTrashed ? (
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="outlined"
            disabled={busy || !isValidDraft || !hasChanged}
            onClick={() => {
              if (draftIso) {
                void onSaveReminder(draftIso).then((ok) => {
                  if (ok) setDraftState(null);
                });
              }
            }}
          >
            {BOOKMARK_DETAIL_STRINGS.reminderSaveLabel}
          </Button>
          {reminderAt ? (
            <Button
              size="small"
              color="inherit"
              disabled={busy}
              onClick={() => {
                setDraftState({ baseReminderAt: reminderAt, value: null });
                void onSaveReminder(null).then((ok) => {
                  if (ok) setDraftState(null);
                });
              }}
            >
              {BOOKMARK_DETAIL_STRINGS.reminderClearLabel}
            </Button>
          ) : null}
        </Stack>
      ) : null}
    </Stack>
  );
}
