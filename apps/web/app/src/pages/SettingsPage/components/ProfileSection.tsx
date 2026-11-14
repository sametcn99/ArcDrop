import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useAuthStore } from '../../../stores/authStore';
import { changePasswordAction } from '../actions/settingsActions';
import { SETTINGS_PAGE_STRINGS as S } from '../strings';

interface FormState {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const EMPTY: FormState = { currentPassword: '', newPassword: '', confirmPassword: '' };

export function ProfileSection() {
  const user = useAuthStore((s) => s.user);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [mismatch, setMismatch] = useState(false);

  const set = (key: keyof FormState) => (value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setMismatch(false);
  };

  const handleSubmit = async () => {
    if (form.newPassword !== form.confirmPassword) {
      setMismatch(true);
      return;
    }
    setSubmitting(true);
    const ok = await changePasswordAction({
      currentPassword: form.currentPassword,
      newPassword: form.newPassword,
    });
    setSubmitting(false);
    if (ok) {
      setForm(EMPTY);
    }
  };

  return (
    <Stack spacing={3} data-testid="settings-profile-section">
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle1">{S.profile.emailDisplayTitle}</Typography>
          <Typography variant="body1" data-testid="settings-profile-email">
            {user?.email ?? '—'}
          </Typography>
        </CardContent>
      </Card>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6">{S.profile.changePasswordHeading}</Typography>
          <Alert severity="info" sx={{ mt: 1 }}>
            {S.profile.sessionWarning}
          </Alert>
          <Stack spacing={2} sx={{ mt: 2 }}>
            <TextField
              label={S.profile.currentPassword}
              type="password"
              value={form.currentPassword}
              onChange={(e) => set('currentPassword')(e.target.value)}
              fullWidth
              autoComplete="current-password"
            />
            <TextField
              label={S.profile.newPassword}
              type="password"
              value={form.newPassword}
              onChange={(e) => set('newPassword')(e.target.value)}
              fullWidth
              autoComplete="new-password"
              error={mismatch}
            />
            <TextField
              label={S.profile.confirmPassword}
              type="password"
              value={form.confirmPassword}
              onChange={(e) => set('confirmPassword')(e.target.value)}
              fullWidth
              autoComplete="new-password"
              error={mismatch}
              helperText={mismatch ? S.profile.mismatchError : undefined}
            />
            <Box>
              <Button
                variant="contained"
                onClick={handleSubmit}
                disabled={submitting || form.currentPassword === '' || form.newPassword === ''}
                data-testid="settings-change-password"
              >
                {S.profile.submit}
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
