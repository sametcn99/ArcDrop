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
import { z } from 'zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link as RouterLink } from 'react-router';
import { bootstrapRequestSchema } from '../../../api/schemas/auth';
import { BOOTSTRAP_PAGE_STRINGS } from '../strings';

export interface BootstrapFormProps {
  errorMessage: string | null;
  submitting: boolean;
  onSubmit: (input: { email: string; password: string }) => void;
}

export function BootstrapForm({ errorMessage, submitting, onSubmit }: BootstrapFormProps) {
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<{ email: string; password: string; confirmPassword: string }>({
    resolver: zodResolver(
      bootstrapRequestSchema
        .extend({ confirmPassword: z.string() })
        .refine((values) => values.password === values.confirmPassword, {
          path: ['confirmPassword'],
          message: BOOTSTRAP_PAGE_STRINGS.passwordMismatchError,
        }),
    ),
    defaultValues: { email: '', password: '', confirmPassword: '' },
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

      <Box
        component="form"
        onSubmit={handleSubmit((values) =>
          onSubmit({ email: values.email, password: values.password }),
        )}
        noValidate
      >
        <Stack spacing={2}>
          <TextField
            id="bootstrap-email"
            label={BOOTSTRAP_PAGE_STRINGS.emailLabel}
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
            id="bootstrap-password"
            label={BOOTSTRAP_PAGE_STRINGS.passwordLabel}
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            fullWidth
            required
            {...register('password')}
            error={Boolean(errors.password)}
            helperText={errors.password?.message ?? BOOTSTRAP_PAGE_STRINGS.passwordHelper}
            disabled={busy}
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
            {...register('confirmPassword')}
            error={Boolean(errors.confirmPassword)}
            helperText={errors.confirmPassword?.message}
            disabled={busy}
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
            {busy ? BOOTSTRAP_PAGE_STRINGS.submittingLabel : BOOTSTRAP_PAGE_STRINGS.submitLabel}
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
