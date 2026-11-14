import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { LoginRequest } from '../../../api/schemas/auth';
import { isApiError } from '../../../api/schemas/problem';
import { resolveRedirectTarget } from '../../../app/redirect';
import { useAuthStore, type CompleteTfaInput } from '../../../stores/authStore';
import {
  cancelTotpAction,
  submitCredentialsAction,
  submitTotpAction,
} from '../actions/loginActions';

/**
 * Login orchestration (field state and validation live in the RHF forms —
 * CredentialsStep / TotpStep); this hook owns navigation and server errors.
 */
export function useLoginFlow() {
  const navigate = useNavigate();
  const location = useLocation();
  const status = useAuthStore((s) => s.status);
  const tfaChallenge = useAuthStore((s) => s.tfaChallenge);
  const storeError = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isTotpStep = tfaChallenge !== null || status === 'totp_required';
  const redirectTarget = resolveRedirectTarget(location.state, '/');

  const handleCredentialsSubmit = async (input: LoginRequest) => {
    setFormError(null);
    clearError();
    setSubmitting(true);
    try {
      const outcome = await submitCredentialsAction(input);
      if (outcome.kind === 'authenticated') {
        navigate(redirectTarget, { replace: true });
      }
    } catch (err) {
      setFormError(isApiError(err) ? err.detail : (storeError?.detail ?? 'Sign-in failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleTotpSubmit = async (input: CompleteTfaInput) => {
    setFormError(null);
    clearError();
    setSubmitting(true);
    try {
      await submitTotpAction(input);
      navigate(redirectTarget, { replace: true });
    } catch (err) {
      setFormError(isApiError(err) ? err.detail : (storeError?.detail ?? 'Verification failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleBackToCredentials = () => {
    cancelTotpAction();
    setFormError(null);
    clearError();
  };

  return {
    isTotpStep,
    tfaEmail: tfaChallenge?.email ?? '',
    submitting,
    errorMessage: formError ?? (isTotpStep ? (storeError?.detail ?? null) : null),
    handleCredentialsSubmit,
    handleTotpSubmit,
    handleBackToCredentials,
  };
}
