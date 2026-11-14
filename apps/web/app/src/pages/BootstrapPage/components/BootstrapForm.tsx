import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState, type FormEvent } from 'react';
import { Link as RouterLink } from 'react-router';
import type { BootstrapFieldErrors } from '../hooks/useBootstrapForm';
import { BOOTSTRAP_PAGE_STRINGS } from '../strings';

export interface BootstrapFormProps {
  email: string;
  onEmailChange: (value: string) => void;
  password: string;
  onPasswordChange: (value: string) => void;
  confirmPassword: string;
  onConfirmPasswordChange: (value: string) => void;
  fieldErrors: BootstrapFieldErrors;
  errorMessage: string | null;
  submitting: boolean;
  onSubmit: (event: FormEvent) => void;
}

export function BootstrapForm({
  email,
  onEmailChange,
  password,
  onPasswordChange,
  confirmPassword,
  onConfirmPasswordChange,
  fieldErrors,
  errorMessage,
  submitting,
  onSubmit,
}: BootstrapFormProps) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <Stack spacing={2.5}>
      {errorMessage ? (
        <Alert severity="error" role="alert">
          {errorMessage}
        </Alert>
      ) : null}

      <Box component="form" onSubmit={onSubmit} noValidate>
        <Stack spacing={2}>
          <TextField
            id="bootstrap-email"
            label={BOOTSTRAP_PAGE_STRINGS.emailLabel}
            type="email"
            autoComplete="email"
            autoFocus
            fullWidth
            required
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            error={Boolean(fieldErrors.email)}
            helperText={fieldErrors.email}
            disabled={submitting}
          />

          <TextField
            id="bootstrap-password"
            label={BOOTSTRAP_PAGE_STRINGS.passwordLabel}
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            fullWidth
            required
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            error={Boolean(fieldErrors.password)}
            helperText={fieldErrors.password ?? BOOTSTRAP_PAGE_STRINGS.passwordHelper}
            disabled={submitting}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label={BOOTSTRAP_PAGE_STRINGS.toggleVisibilityLabel}
                      onClick={() => setShowPassword((prev) => !prev)}
                      edge="end"
                      size="small"
                    >
                      {showPassword ? <VisibilityOffOutlinedIcon /> : <VisibilityOutlinedIcon />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />

          <TextField
            id="bootstrap-confirm-password"
            label={BOOTSTRAP_PAGE_STRINGS.confirmPasswordLabel}
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            fullWidth
            required
            value={confirmPassword}
            onChange={(e) => onConfirmPasswordChange(e.target.value)}
            error={Boolean(fieldErrors.confirmPassword)}
            helperText={fieldErrors.confirmPassword}
            disabled={submitting}
          />

          <Button type="submit" variant="contained" size="large" fullWidth disabled={submitting}>
            {submitting
              ? BOOTSTRAP_PAGE_STRINGS.submittingLabel
              : BOOTSTRAP_PAGE_STRINGS.submitLabel}
          </Button>
        </Stack>
      </Box>

      <Divider />

      <Typography variant="body2" color="text.secondary">
        {BOOTSTRAP_PAGE_STRINGS.signInLinkPrompt}{' '}
        <Link component={RouterLink} to="/login" underline="hover">
          {BOOTSTRAP_PAGE_STRINGS.signInLinkLabel}
        </Link>
      </Typography>
    </Stack>
  );
}
