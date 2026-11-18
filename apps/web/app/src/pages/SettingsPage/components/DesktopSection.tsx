import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { platform } from '../../../platform';
import { SETTINGS_PAGE_STRINGS as S } from '../strings';

/**
 * Settings → Desktop (plan T5): desktop-only conveniences. Rendered only
 * inside a Tauri webview on a desktop OS; hidden on web, extension and
 * mobile builds. The window position/size recall comes from the
 * window-state plugin automatically — this section exposes autostart.
 */
export function DesktopSection() {
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [autostartError, setAutostartError] = useState<string | null>(null);

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
      </CardContent>
    </Card>
  );
}
