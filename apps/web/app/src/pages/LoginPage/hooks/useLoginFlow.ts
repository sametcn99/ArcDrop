import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { loginRequestSchema } from '../../../api/schemas/auth';
import { isApiError } from '../../../api/schemas/problem';
import { resolveRedirectTarget } from '../../../app/redirect';
import { useAuthStore } from '../../../stores/authStore';
import {
  cancelTotpAction,
  submitCredentialsAction,
  submitTotpAction,
} from '../actions/loginActions';
import { LOGIN_PAGE_STRINGS } from '../strings';

export interface LoginFieldErrors {
  email?: string;
  password?: string;
  code?: string;
}

export function useLoginFlow() {
  const navigate = useNavigate();
  const location = useLocation();
  const status = useAuthStore((s) => s.status);
  const tfaChallenge = useAuthStore((s) => s.tfaChallenge);
  const storeError = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isTotpStep = tfaChallenge !== null || status === 'totp_required';
  const redirectTarget = resolveRedirectTarget(location.state, '/');

  const handleCredentialsSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    clearError();

    const parsed = loginRequestSchema.safeParse({ email, password });
    if (!parsed.success) {
      const nextErrors: LoginFieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === 'email' && !nextErrors.email) nextErrors.email = issue.message;
        if (key === 'password' && !nextErrors.password) nextErrors.password = issue.message;
      }
      setFieldErrors(nextErrors);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    try {
      const outcome = await submitCredentialsAction(parsed.data);
      if (outcome.kind === 'authenticated') {
        navigate(redirectTarget, { replace: true });
      } else {
        setCode('');
        setUseRecoveryCode(false);
      }
    } catch (err) {
      setFormError(isApiError(err) ? err.detail : (storeError?.detail ?? 'Sign-in failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleTotpSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    clearError();

    const trimmed = code.trim();
    if (!trimmed) {
      setFieldErrors({
        code: useRecoveryCode
          ? LOGIN_PAGE_STRINGS.validationRecoveryRequired
          : LOGIN_PAGE_STRINGS.validationTotpRequired,
      });
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    try {
      await submitTotpAction(useRecoveryCode ? { recoveryCode: trimmed } : { code: trimmed });
      navigate(redirectTarget, { replace: true });
    } catch (err) {
      setFormError(isApiError(err) ? err.detail : (storeError?.detail ?? 'Verification failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleRecoveryMode = () => {
    setUseRecoveryCode((prev) => !prev);
    setCode('');
    setFieldErrors({});
    setFormError(null);
    clearError();
  };

  const handleBackToCredentials = () => {
    cancelTotpAction();
    setCode('');
    setUseRecoveryCode(false);
    setFieldErrors({});
    setFormError(null);
  };

  return {
    isTotpStep,
    tfaEmail: tfaChallenge?.email ?? email,
    email,
    setEmail,
    password,
    setPassword,
    code,
    setCode,
    useRecoveryCode,
    fieldErrors,
    submitting,
    errorMessage: formError ?? (isTotpStep ? (storeError?.detail ?? null) : null),
    handleCredentialsSubmit,
    handleTotpSubmit,
    handleToggleRecoveryMode,
    handleBackToCredentials,
  };
}
