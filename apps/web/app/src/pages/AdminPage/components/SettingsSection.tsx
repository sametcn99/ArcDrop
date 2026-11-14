import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import type { Settings } from '../../../api/schemas/settings';
import { saveSettingsAction } from '../actions/adminActions';
import { useAdminSettings } from '../hooks/useAdminData';
import { ADMIN_PAGE_STRINGS as S } from '../strings';

export function SettingsSection() {
  const { settings, loading, error, reload } = useAdminSettings();
  const [draftOverride, setDraftOverride] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const draft = draftOverride ?? settings;

  const patch = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setDraftOverride((prev) => {
      const base = prev ?? settings;
      return base ? { ...base, [key]: value } : null;
    });
  };

  const numberField = (key: keyof Settings, label: string, testId: string) => (
    <TextField
      label={label}
      type="number"
      value={draft ? String(draft[key]) : ''}
      onChange={(e) => patch(key, Number(e.target.value) as Settings[typeof key])}
      fullWidth
      slotProps={{ htmlInput: { min: 1 } }}
      data-testid={testId}
    />
  );

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    const ok = await saveSettingsAction(draft);
    setSaving(false);
    if (ok) {
      setDraftOverride(null);
      await reload();
    }
  };

  return (
    <Card variant="outlined" data-testid="admin-settings-section">
      <CardContent>
        <Typography variant="h6">{S.settings.heading}</Typography>
        {error ? (
          <Typography color="error" variant="body2" sx={{ mt: 1 }}>
            {error}
          </Typography>
        ) : null}
        {loading || draft === null ? (
          <Stack spacing={2} sx={{ mt: 2 }}>
            <Skeleton variant="rounded" height={56} />
            <Skeleton variant="rounded" height={56} />
            <Skeleton variant="rounded" height={56} />
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ mt: 2 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={draft.registrationOpen}
                  onChange={(e) => patch('registrationOpen', e.target.checked)}
                  data-testid="admin-settings-registration"
                />
              }
              label={S.settings.registrationOpen}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: -1.5 }}>
              {S.settings.registrationHelper}
            </Typography>
            <Stack direction="row" spacing={2} sx={{ rowGap: 2, flexWrap: 'wrap' }}>
              {numberField(
                'trashRetentionDays',
                S.settings.trashRetentionDays,
                'admin-settings-trash-retention',
              )}
              {numberField(
                'changeLogRetentionDays',
                S.settings.changeLogRetentionDays,
                'admin-settings-changelog-retention',
              )}
            </Stack>
            <TextField
              select
              label={S.settings.brokenLinkCheckMode}
              value={draft.brokenLinkCheckMode}
              onChange={(e) =>
                patch('brokenLinkCheckMode', e.target.value as Settings['brokenLinkCheckMode'])
              }
              fullWidth
              data-testid="admin-settings-broken-mode"
            >
              {(['off', 'basic', 'default', 'strict'] as const).map((mode) => (
                <MenuItem key={mode} value={mode}>
                  {mode}
                </MenuItem>
              ))}
            </TextField>
            <Stack direction="row" spacing={2} sx={{ rowGap: 2, flexWrap: 'wrap' }}>
              {numberField(
                'archiveMaxBytes',
                S.settings.archiveMaxBytes,
                'admin-settings-archive-cap',
              )}
              {numberField('fileMaxBytes', S.settings.fileMaxBytes, 'admin-settings-file-cap')}
              {numberField(
                'monthlyUploadQuotaBytes',
                S.settings.monthlyUploadQuotaBytes,
                'admin-settings-quota',
              )}
            </Stack>
            <Stack direction="row">
              <Button
                variant="contained"
                onClick={handleSave}
                disabled={saving}
                data-testid="admin-settings-save"
              >
                {S.settings.save}
              </Button>
            </Stack>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
