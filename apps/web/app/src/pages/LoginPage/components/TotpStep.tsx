import ArrowBackOutlinedIcon from '@mui/icons-material/ArrowBackOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { CompleteTfaInput } from '../../../stores/authStore';
import { LOGIN_PAGE_STRINGS } from '../strings';

export interface TotpStepProps {
  errorMessage: string | null;
  submitting: boolean;
  onSubmit: (input: CompleteTfaInput) => void;
  onBack: () => void;
}

export function TotpStep({ errorMessage, submitting, onSubmit, onBack }: TotpStepProps) {
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);

  const schema = useMemo(
    () =>
      z.object({
        code: z
          .string()
          .trim()
          .min(
            1,
            useRecoveryCode
              ? LOGIN_PAGE_STRINGS.validationRecoveryRequired
              : LOGIN_PAGE_STRINGS.validationTotpRequired,
          ),
      }),
    [useRecoveryCode],
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<{ code: string }>({
    resolver: zodResolver(schema),
    defaultValues: { code: '' },
    mode: 'onTouched',
  });

  const busy = submitting || isSubmitting;

  const label = useRecoveryCode
    ? LOGIN_PAGE_STRINGS.recoveryCodeLabel
    : LOGIN_PAGE_STRINGS.totpCodeLabel;
  const placeholder = useRecoveryCode
    ? LOGIN_PAGE_STRINGS.recoveryCodePlaceholder
    : LOGIN_PAGE_STRINGS.totpCodePlaceholder;
  const helper =
    errors.code?.message ??
    (useRecoveryCode ? LOGIN_PAGE_STRINGS.recoveryCodeHelper : LOGIN_PAGE_STRINGS.totpCodeHelper);

  const handleToggleRecoveryMode = () => {
    setUseRecoveryCode((prev) => !prev);
  };

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
          onSubmit(useRecoveryCode ? { recoveryCode: values.code } : { code: values.code }),
        )}
        noValidate
      >
        <Stack spacing={2}>
          <TextField
            id="login-tfa-code"
            label={label}
            placeholder={placeholder}
            autoComplete={useRecoveryCode ? 'off' : 'one-time-code'}
            autoFocus
            fullWidth
            required
            {...register('code')}
            error={Boolean(errors.code)}
            helperText={helper}
            disabled={busy}
            slotProps={{
              htmlInput: {
                inputMode: useRecoveryCode ? 'text' : 'numeric',
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
            {busy ? LOGIN_PAGE_STRINGS.verifyingLabel : LOGIN_PAGE_STRINGS.verifySubmitLabel}
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
          disabled={busy}
        >
          {LOGIN_PAGE_STRINGS.backToSignInLabel}
        </Button>

        <Button
          type="button"
          variant="text"
          size="small"
          onClick={handleToggleRecoveryMode}
          disabled={busy}
        >
          {useRecoveryCode
            ? LOGIN_PAGE_STRINGS.useTotpModeLabel
            : LOGIN_PAGE_STRINGS.useRecoveryModeLabel}
        </Button>
      </Stack>
    </Stack>
  );
}
