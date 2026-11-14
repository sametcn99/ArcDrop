import BlockOutlinedIcon from '@mui/icons-material/BlockOutlined';
import CheckCircleOutlineOutlinedIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import ErrorOutlineOutlinedIcon from '@mui/icons-material/ErrorOutlineOutlined';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import RemoveCircleOutlineOutlinedIcon from '@mui/icons-material/RemoveCircleOutlineOutlined';
import Chip, { type ChipProps } from '@mui/material/Chip';
import type { BookmarkCacheStatus } from '../../api/schemas/bookmarks';
import { SHARED_CACHE_STATUS_STRINGS } from '../strings';

export interface CacheStatusChipProps {
  status: BookmarkCacheStatus;
  size?: ChipProps['size'];
}

const STATUS_META: Record<
  BookmarkCacheStatus,
  {
    label: string;
    color: ChipProps['color'];
    icon: ChipProps['icon'];
  }
> = {
  ready: {
    label: SHARED_CACHE_STATUS_STRINGS.ready,
    color: 'success',
    icon: <CheckCircleOutlineOutlinedIcon fontSize="small" />,
  },
  pending: {
    label: SHARED_CACHE_STATUS_STRINGS.pending,
    color: 'info',
    icon: <HourglassEmptyIcon fontSize="small" />,
  },
  failed: {
    label: SHARED_CACHE_STATUS_STRINGS.failed,
    color: 'error',
    icon: <ErrorOutlineOutlinedIcon fontSize="small" />,
  },
  'invalid-origin': {
    label: SHARED_CACHE_STATUS_STRINGS['invalid-origin'],
    color: 'warning',
    icon: <BlockOutlinedIcon fontSize="small" />,
  },
  skipped: {
    label: SHARED_CACHE_STATUS_STRINGS.skipped,
    color: 'default',
    icon: <RemoveCircleOutlineOutlinedIcon fontSize="small" />,
  },
};

export function CacheStatusChip({ status, size = 'small' }: CacheStatusChipProps) {
  const meta = STATUS_META[status];
  return (
    <Chip
      size={size}
      variant="outlined"
      color={meta.color}
      icon={meta.icon}
      label={meta.label}
      data-testid={`cache-status-chip-${status}`}
    />
  );
}
