import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import { SHARED_BOOKMARK_STRINGS } from '../strings';

export interface ReminderBadgeProps {
  reminderAt: string | null;
  remindedAt: string | null;
}

export function ReminderBadge({ reminderAt, remindedAt }: ReminderBadgeProps) {
  if (!reminderAt) return null;

  const formatted = new Date(reminderAt).toLocaleString();
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
}
