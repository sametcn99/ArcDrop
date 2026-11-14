import ArrowBackOutlinedIcon from '@mui/icons-material/ArrowBackOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import type { FormEvent } from 'react';
import type { LoginFieldErrors } from '../hooks/useLoginFlow';
import { LOGIN_PAGE_STRINGS } from '../strings';

export interface TotpStepProps {
  code: string;
  onCodeChange: (value: string) => void;
  useRecoveryCode: boolean;
  onToggleRecoveryMode: () => void;
  fieldErrors: LoginFieldErrors;
  errorMessage: string | null;
  submitting: boolean;
  onSubmit: (event: FormEvent) => void;
  onBack: () => void;
}

export function TotpStep({
  code,
  onCodeChange,
  useRecoveryCode,
  onToggleRecoveryMode,
  fieldErrors,
  errorMessage,
  submitting,
  onSubmit,
  onBack,
}: TotpStepProps) {
  const label = useRecoveryCode
    ? LOGIN_PAGE_STRINGS.recoveryCodeLabel
    : LOGIN_PAGE_STRINGS.totpCodeLabel;
  const placeholder = useRecoveryCode
    ? LOGIN_PAGE_STRINGS.recoveryCodePlaceholder
    : LOGIN_PAGE_STRINGS.totpCodePlaceholder;
  const helper =
    fieldErrors.code ??
    (useRecoveryCode ? LOGIN_PAGE_STRINGS.recoveryCodeHelper : LOGIN_PAGE_STRINGS.totpCodeHelper);

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
            id="login-tfa-code"
            label={label}
            placeholder={placeholder}
            autoComplete={useRecoveryCode ? 'off' : 'one-time-code'}
            autoFocus
            fullWidth
            required
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            error={Boolean(fieldErrors.code)}
            helperText={helper}
            disabled={submitting}
            slotProps={{
              htmlInput: {
                inputMode: useRecoveryCode ? 'text' : 'numeric',
              },
            }}
          />

          <Button type="submit" variant="contained" size="large" fullWidth disabled={submitting}>
            {submitting ? LOGIN_PAGE_STRINGS.verifyingLabel : LOGIN_PAGE_STRINGS.verifySubmitLabel}
          </Button>
        </Stack>
      </Box>

      <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <Button
          type="button"
          variant="text"
          size="small"
          startIcon={<ArrowBackOutlinedIcon />}
          onClick={onBack}
          disabled={submitting}
        >
          {LOGIN_PAGE_STRINGS.backToSignInLabel}
        </Button>

        <Button
          type="button"
          variant="text"
          size="small"
          onClick={onToggleRecoveryMode}
          disabled={submitting}
        >
          {useRecoveryCode
            ? LOGIN_PAGE_STRINGS.useTotpModeLabel
            : LOGIN_PAGE_STRINGS.useRecoveryModeLabel}
        </Button>
      </Stack>
    </Stack>
  );
}
