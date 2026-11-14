import CloudDoneOutlinedIcon from '@mui/icons-material/CloudDoneOutlined';
import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined';
import SyncOutlinedIcon from '@mui/icons-material/SyncOutlined';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import { APP_STRINGS } from '../../app/strings';
import { useSyncStore, type SyncConnectionState } from '../../stores/syncStore';

const STATUS_CONFIG: Record<
  SyncConnectionState,
  {
    label: string;
    color: 'success' | 'warning' | 'error';
  }
> = {
  live: {
    label: APP_STRINGS.syncLiveLabel,
    color: 'success',
  },
  polling: {
    label: APP_STRINGS.syncPollingLabel,
    color: 'warning',
  },
  offline: {
    label: APP_STRINGS.syncOfflineLabel,
    color: 'error',
  },
};

function renderStatusIcon(connectionState: SyncConnectionState, isBusy: boolean) {
  if (isBusy || connectionState === 'polling') {
    return <SyncOutlinedIcon fontSize="small" />;
  }
  if (connectionState === 'live') {
    return <CloudDoneOutlinedIcon fontSize="small" />;
  }
  return <CloudOffOutlinedIcon fontSize="small" />;
}

export function SyncStatusIndicator() {
  const connectionState = useSyncStore((s) => s.connectionState);
  const cursor = useSyncStore((s) => s.cursor);
  const isBootstrapping = useSyncStore((s) => s.isBootstrapping);
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const lastError = useSyncStore((s) => s.lastError);

  const cfg = STATUS_CONFIG[connectionState];
  const isBusy = isBootstrapping || isSyncing;
  const tooltipText = lastError
    ? `${APP_STRINGS.syncTooltipPrefix}: ${cfg.label} (#${cursor}) — ${lastError}`
    : `${APP_STRINGS.syncTooltipPrefix}: ${cfg.label} (#${cursor})`;

  return (
    <Tooltip title={tooltipText}>
      <Chip
        size="small"
        variant="outlined"
        color={cfg.color}
        icon={renderStatusIcon(connectionState, isBusy)}
        label={`${cfg.label} · #${cursor}`}
        aria-label={`${APP_STRINGS.syncStatusAriaPrefix}: ${cfg.label} (${cursor})`}
        data-testid="sync-status-indicator"
        data-sync-state={connectionState}
      />
    </Tooltip>
  );
}
