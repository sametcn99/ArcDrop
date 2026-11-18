import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { platform } from '../../../platform';
import { SETTINGS_PAGE_STRINGS as S } from '../strings';

type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';

/**
 * Settings → Desktop (plan T5/T6): desktop-only conveniences. Rendered only
 * inside a Tauri webview on a desktop OS; hidden on web, extension and
 * mobile builds. Window position/size recall comes from the window-state
 * plugin automatically; this section exposes autostart + updater.
 */
export function DesktopSection() {
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [autostartError, setAutostartError] = useState<string | null>(null);

  const [phase, setPhase] = useState<UpdatePhase>('idle');
  const [update, setUpdate] = useState<Update | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    if (!platform.isTauri || !platform.isDesktop) {
      return;
    }
    isEnabled()
      .then(setAutostartEnabled)
      .catch(() => setAutostartError(S.desktop.autostartReadError));
  }, []);

  if (!platform.isTauri || !platform.isDesktop) {
    return null;
  }

  const handleAutostartToggle = (_event: unknown, checked: boolean) => {
    setAutostartError(null);
    const apply = checked ? enable() : disable();
    void apply
      .then(() => setAutostartEnabled(checked))
      .catch(() => setAutostartError(S.desktop.autostartToggleError));
  };

  const handleCheckForUpdates = async () => {
    setUpdateError(null);
    setPhase('checking');
    try {
      // The updater plugin asks GitHub Releases for latest.json (plan T6).
      const found = await check();
      if (found) {
        setUpdate(found);
        setPhase('available');
      } else {
        setUpdate(null);
        setPhase('idle');
      }
    } catch {
      setPhase('error');
      setUpdateError(S.desktop.updaterCheckError);
    }
  };

  const handleDownloadAndInstall = async () => {
    if (!update) {
      return;
    }
    setPhase('downloading');
    try {
      // Streams content and installs; a relaunch applies the new version.
      await update.downloadAndInstall();
      setPhase('ready');
    } catch {
      setPhase('error');
      setUpdateError(S.desktop.updaterInstallError);
    }
  };

  const handleRelaunch = () => {
    void relaunch();
  };

  const updaterStatusText = () => {
    switch (phase) {
      case 'checking':
        return S.desktop.updaterCheckingLabel;
      case 'available':
        return `${S.desktop.updaterAvailablePrefix} ${update?.version ?? ''}`;
      case 'downloading':
        return S.desktop.updaterDownloadingLabel;
      case 'ready':
        return S.desktop.updaterReadyLabel;
      case 'error':
        return updateError ?? S.desktop.updaterCheckError;
      default:
        return S.desktop.updaterUpToDateLabel;
    }
  };

  return (
    <Card variant="outlined" data-testid="settings-desktop-section">
      <CardContent>
        <Typography variant="h6">{S.desktop.heading}</Typography>
        <Typography variant="body2" color="text.secondary">
          {S.desktop.description}
        </Typography>
        <Stack spacing={1} sx={{ mt: 1.5 }}>
          <FormControlLabel
            control={
              <Switch
                checked={autostartEnabled}
                onChange={handleAutostartToggle}
                data-testid="settings-desktop-autostart"
              />
            }
            label={S.desktop.autostartLabel}
          />
          <Typography variant="caption" color="text.secondary">
            {S.desktop.autostartHint}
          </Typography>
          {autostartError ? (
            <Typography variant="caption" color="error" role="alert">
              {autostartError}
            </Typography>
          ) : null}
        </Stack>

        <Stack spacing={1} sx={{ mt: 2.5 }}>
          <Typography variant="subtitle2">{S.desktop.updaterHeading}</Typography>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={
                phase === 'checking' || phase === 'downloading' ? (
                  <CircularProgress size={14} color="inherit" aria-hidden />
                ) : phase === 'available' || phase === 'ready' ? (
                  <DownloadOutlinedIcon fontSize="small" />
                ) : undefined
              }
              disabled={phase === 'checking' || phase === 'downloading' || phase === 'ready'}
              onClick={() => {
                if (phase === 'available') {
                  void handleDownloadAndInstall();
                } else {
                  void handleCheckForUpdates();
                }
              }}
              data-testid="settings-desktop-updater"
            >
              {phase === 'available' ? S.desktop.updaterDownloadLabel : S.desktop.updaterCheckLabel}
            </Button>
            <Typography variant="body2" color={phase === 'error' ? 'error' : 'text.secondary'}>
              {updaterStatusText()}
            </Typography>
          </Stack>
          {phase === 'ready' ? (
            <Button size="small" variant="contained" onClick={handleRelaunch}>
              {S.desktop.updaterRestartLabel}
            </Button>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}
