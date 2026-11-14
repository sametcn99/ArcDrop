import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
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
import { claimRequestSchema } from '../../../api/schemas/auth';
import { CLAIM_PAGE_STRINGS } from '../strings';

export interface ClaimFormProps {
  urlToken: string;
  hasTokenFromUrl: boolean;
  errorState: { message: string; isGone: boolean } | null;
  submitting: boolean;
  onSubmit: (input: { token: string; password: string }) => void;
}

export function ClaimForm({
  urlToken,
  hasTokenFromUrl,
  errorState,
  submitting,
  onSubmit,
}: ClaimFormProps) {
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<{ token: string; password: string; confirmPassword: string }>({
    resolver: zodResolver(
      claimRequestSchema
        .extend({ confirmPassword: z.string() })
        .refine((values) => values.password === values.confirmPassword, {
          path: ['confirmPassword'],
          message: CLAIM_PAGE_STRINGS.passwordMismatchError,
        }),
    ),
    defaultValues: { token: urlToken, password: '', confirmPassword: '' },
    mode: 'onTouched',
  });

  const busy = submitting || isSubmitting;

  return (
    <Stack spacing={2.5}>
      {errorState ? (
        <Alert severity="error" role="alert">
          {errorState.isGone ? (
            <>
              <AlertTitle>{CLAIM_PAGE_STRINGS.expiredTokenTitle}</AlertTitle>
              <Typography variant="body2">{errorState.message}</Typography>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                {CLAIM_PAGE_STRINGS.expiredTokenHint}
              </Typography>
            </>
          ) : (
            errorState.message
          )}
        </Alert>
      ) : null}

      <Box
        component="form"
        onSubmit={handleSubmit((values) =>
          onSubmit({ token: values.token, password: values.password }),
        )}
        noValidate
      >
        <Stack spacing={2}>
          <TextField
            id="claim-token"
            label={CLAIM_PAGE_STRINGS.tokenLabel}
            autoFocus={!hasTokenFromUrl}
            fullWidth
            required
            {...register('token')}
            error={Boolean(errors.token)}
            helperText={errors.token?.message ?? CLAIM_PAGE_STRINGS.tokenHelper}
            disabled={busy}
          />

          <TextField
            id="claim-password"
            label={CLAIM_PAGE_STRINGS.passwordLabel}
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            autoFocus={hasTokenFromUrl}
            fullWidth
            required
            {...register('password')}
            error={Boolean(errors.password)}
            helperText={errors.password?.message ?? CLAIM_PAGE_STRINGS.passwordHelper}
            disabled={busy}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label={CLAIM_PAGE_STRINGS.toggleVisibilityLabel}
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
            id="claim-confirm-password"
            label={CLAIM_PAGE_STRINGS.confirmPasswordLabel}
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
            {busy ? CLAIM_PAGE_STRINGS.submittingLabel : CLAIM_PAGE_STRINGS.submitLabel}
          </Button>
        </Stack>
      </Box>

      <Divider />

      <Typography variant="body2" color="text.secondary">
        {CLAIM_PAGE_STRINGS.signInLinkPrompt}{' '}
        <Link component={RouterLink} to="/login" underline="hover">
          {CLAIM_PAGE_STRINGS.signInLinkLabel}
        </Link>
      </Typography>
    </Stack>
  );
}
