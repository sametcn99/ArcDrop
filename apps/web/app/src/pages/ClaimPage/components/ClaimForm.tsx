import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
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
import type { ClaimFieldErrors } from '../hooks/useClaimForm';
import { CLAIM_PAGE_STRINGS } from '../strings';

export interface ClaimFormProps {
  token: string;
  onTokenChange: (value: string) => void;
  hasTokenFromUrl: boolean;
  password: string;
  onPasswordChange: (value: string) => void;
  confirmPassword: string;
  onConfirmPasswordChange: (value: string) => void;
  fieldErrors: ClaimFieldErrors;
  errorState: { message: string; isGone: boolean } | null;
  submitting: boolean;
  onSubmit: (event: FormEvent) => void;
}

export function ClaimForm({
  token,
  onTokenChange,
  hasTokenFromUrl,
  password,
  onPasswordChange,
  confirmPassword,
  onConfirmPasswordChange,
  fieldErrors,
  errorState,
  submitting,
  onSubmit,
}: ClaimFormProps) {
  const [showPassword, setShowPassword] = useState(false);

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

      <Box component="form" onSubmit={onSubmit} noValidate>
        <Stack spacing={2}>
          <TextField
            id="claim-token"
            label={CLAIM_PAGE_STRINGS.tokenLabel}
            autoFocus={!hasTokenFromUrl}
            fullWidth
            required
            value={token}
            onChange={(e) => onTokenChange(e.target.value)}
            error={Boolean(fieldErrors.token)}
            helperText={fieldErrors.token ?? CLAIM_PAGE_STRINGS.tokenHelper}
            disabled={submitting}
          />

          <TextField
            id="claim-password"
            label={CLAIM_PAGE_STRINGS.passwordLabel}
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            autoFocus={hasTokenFromUrl}
            fullWidth
            required
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            error={Boolean(fieldErrors.password)}
            helperText={fieldErrors.password ?? CLAIM_PAGE_STRINGS.passwordHelper}
            disabled={submitting}
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
            value={confirmPassword}
            onChange={(e) => onConfirmPasswordChange(e.target.value)}
            error={Boolean(fieldErrors.confirmPassword)}
            helperText={fieldErrors.confirmPassword}
            disabled={submitting}
          />

          <Button type="submit" variant="contained" size="large" fullWidth disabled={submitting}>
            {submitting ? CLAIM_PAGE_STRINGS.submittingLabel : CLAIM_PAGE_STRINGS.submitLabel}
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
