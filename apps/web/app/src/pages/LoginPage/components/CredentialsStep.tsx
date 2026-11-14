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
import type { LoginFieldErrors } from '../hooks/useLoginFlow';
import { LOGIN_PAGE_STRINGS } from '../strings';

export interface CredentialsStepProps {
  email: string;
  onEmailChange: (value: string) => void;
  password: string;
  onPasswordChange: (value: string) => void;
  fieldErrors: LoginFieldErrors;
  errorMessage: string | null;
  submitting: boolean;
  onSubmit: (event: FormEvent) => void;
}

export function CredentialsStep({
  email,
  onEmailChange,
  password,
  onPasswordChange,
  fieldErrors,
  errorMessage,
  submitting,
  onSubmit,
}: CredentialsStepProps) {
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
            id="login-email"
            label={LOGIN_PAGE_STRINGS.emailLabel}
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
            id="login-password"
            label={LOGIN_PAGE_STRINGS.passwordLabel}
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            fullWidth
            required
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            error={Boolean(fieldErrors.password)}
            helperText={fieldErrors.password}
            disabled={submitting}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label={LOGIN_PAGE_STRINGS.toggleVisibilityLabel}
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

          <Button type="submit" variant="contained" size="large" fullWidth disabled={submitting}>
            {submitting ? LOGIN_PAGE_STRINGS.submittingLabel : LOGIN_PAGE_STRINGS.submitLabel}
          </Button>
        </Stack>
      </Box>

      <Divider />

      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">
          {LOGIN_PAGE_STRINGS.bootstrapLinkPrompt}{' '}
          <Link component={RouterLink} to="/bootstrap" underline="hover">
            {LOGIN_PAGE_STRINGS.bootstrapLinkLabel}
          </Link>
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {LOGIN_PAGE_STRINGS.claimLinkPrompt}{' '}
          <Link component={RouterLink} to="/claim" underline="hover">
            {LOGIN_PAGE_STRINGS.claimLinkLabel}
          </Link>
        </Typography>
      </Stack>
    </Stack>
  );
}
