import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { claimRequestSchema } from '../../../api/schemas/auth';
import { isApiError } from '../../../api/schemas/problem';
import { claimTokenAction } from '../actions/claimActions';
import { CLAIM_PAGE_STRINGS } from '../strings';

export interface ClaimFieldErrors {
  token?: string;
  password?: string;
  confirmPassword?: string;
}

export function useClaimForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlToken = searchParams.get('token') ?? '';

  const [tokenOverride, setTokenOverride] = useState<string | null>(null);
  const token = tokenOverride ?? urlToken;
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<ClaimFieldErrors>({});
  const [errorState, setErrorState] = useState<{ message: string; isGone: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setErrorState(null);

    const nextErrors: ClaimFieldErrors = {};
    const parsed = claimRequestSchema.safeParse({ token, password });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === 'token' && !nextErrors.token) nextErrors.token = issue.message;
        if (key === 'password' && !nextErrors.password) nextErrors.password = issue.message;
      }
    }
    if (password !== confirmPassword) {
      nextErrors.confirmPassword = CLAIM_PAGE_STRINGS.passwordMismatchError;
    }

    if (nextErrors.token || nextErrors.password || nextErrors.confirmPassword || !parsed.success) {
      setFieldErrors(nextErrors);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    try {
      await claimTokenAction(parsed.data);
      navigate('/', { replace: true });
    } catch (err) {
      if (isApiError(err)) {
        const isGone = err.status === 410 || err.code === 'GONE';
        setErrorState({
          message: err.detail || CLAIM_PAGE_STRINGS.expiredTokenFallback,
          isGone,
        });
      } else {
        setErrorState({
          message: 'Failed to claim token',
          isGone: false,
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return {
    token,
    setToken: setTokenOverride,
    hasTokenFromUrl: urlToken.length > 0,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    fieldErrors,
    errorState,
    submitting,
    handleSubmit,
  };
}
