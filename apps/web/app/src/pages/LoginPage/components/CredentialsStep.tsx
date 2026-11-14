import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link as RouterLink } from 'react-router';
import { loginRequestSchema, type LoginRequest } from '../../../api/schemas/auth';
import { LOGIN_PAGE_STRINGS } from '../strings';

export interface CredentialsStepProps {
  errorMessage: string | null;
  submitting: boolean;
  onSubmit: (input: LoginRequest) => void;
}

export function CredentialsStep({ errorMessage, submitting, onSubmit }: CredentialsStepProps) {
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: '', password: '' },
    mode: 'onTouched',
  });

  const busy = submitting || isSubmitting;

  return (
    <Stack spacing={2.5}>
      {errorMessage ? (
        <Alert severity="error" role="alert">
          {errorMessage}
        </Alert>
      ) : null}

      <Box component="form" onSubmit={handleSubmit((values) => onSubmit(values))} noValidate>
        <Stack spacing={2}>
          <TextField
            id="login-email"
            label={LOGIN_PAGE_STRINGS.emailLabel}
            type="email"
            autoComplete="email"
            autoFocus
            fullWidth
            required
            {...register('email')}
            error={Boolean(errors.email)}
            helperText={errors.email?.message}
            disabled={busy}
          />

          <TextField
            id="login-password"
            label={LOGIN_PAGE_STRINGS.passwordLabel}
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            fullWidth
            required
            {...register('password')}
            error={Boolean(errors.password)}
            helperText={errors.password?.message}
            disabled={busy}
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

          <Button
            type="submit"
            variant="contained"
            size="large"
            fullWidth
            disabled={busy}
            startIcon={
              busy ? <CircularProgress size={18} color="inherit" aria-hidden /> : undefined
            }
          >
            {busy ? LOGIN_PAGE_STRINGS.submittingLabel : LOGIN_PAGE_STRINGS.submitLabel}
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
