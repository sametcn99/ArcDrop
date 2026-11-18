import CloudDoneOutlinedIcon from '@mui/icons-material/CloudDoneOutlined';
import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined';
import SyncOutlinedIcon from '@mui/icons-material/SyncOutlined';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import { APP_STRINGS } from '../../app/strings';
import { syncEngine } from '../../api/sync-engine';
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

  // Plan T5: a single retry affordance when the connection degraded. The
  // engine already auto-reconnects; this lets the user force it immediately.
  const showRetry = connectionState === 'offline' || lastError !== null;

  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      <Tooltip title={tooltipText}>
        <Chip
          size="small"
          color={cfg.color}
          icon={renderStatusIcon(connectionState, isBusy)}
          label={cfg.label}
          aria-label={`${APP_STRINGS.syncStatusAriaPrefix}: ${cfg.label}`}
          data-testid="sync-status-indicator"
          data-sync-state={connectionState}
        />
      </Tooltip>
      {showRetry ? (
        <Tooltip title={APP_STRINGS.syncRetryLabel}>
          <IconButton
            size="small"
            aria-label={APP_STRINGS.syncRetryLabel}
            onClick={() => void syncEngine.pollNow()}
            disabled={isBusy}
            data-testid="sync-retry-button"
          >
            <SyncOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
    </Stack>
  );
}
