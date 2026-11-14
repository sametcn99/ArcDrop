import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import { memo } from 'react';
import { SHARED_BOOKMARK_STRINGS } from '../strings';

export interface ReminderBadgeProps {
  reminderAt: string | null;
  remindedAt: string | null;
}

// `toLocaleString()` constructs an Intl.DateTimeFormat on every call; this
// badge renders once per bookmark row, so reuse a single formatter.
let cachedFormatter: Intl.DateTimeFormat | null = null;
function formatReminderTimestamp(iso: string): string {
  cachedFormatter ??= new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return cachedFormatter.format(new Date(iso));
}

/**
 * Rendered in every row of all four list layouts — memoized so unchanged
 * bookmarks skip re-rendering when an unrelated store update re-renders the
 * page.
 */
export const ReminderBadge = memo(function ReminderBadge({
  reminderAt,
  remindedAt,
}: ReminderBadgeProps) {
  if (!reminderAt) return null;

  const formatted = formatReminderTimestamp(reminderAt);
  const isDue = remindedAt !== null;
  const label = isDue
    ? SHARED_BOOKMARK_STRINGS.reminderDueBadgeLabel
    : `${SHARED_BOOKMARK_STRINGS.reminderBadgePrefix}: ${formatted}`;

  return (
    <Tooltip title={`${SHARED_BOOKMARK_STRINGS.reminderBadgePrefix}: ${formatted}`}>
      <Chip
        size="small"
        variant={isDue ? 'filled' : 'outlined'}
        color={isDue ? 'warning' : 'info'}
        icon={<NotificationsActiveOutlinedIcon />}
        label={label}
        data-testid="bookmark-reminder-badge"
      />
    </Tooltip>
  );
});
