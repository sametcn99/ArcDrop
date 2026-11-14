import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { ClaimRequest } from '../../../api/schemas/auth';
import { isApiError } from '../../../api/schemas/problem';
import { claimTokenAction } from '../actions/claimActions';
import { CLAIM_PAGE_STRINGS } from '../strings';

/**
 * Claim orchestration (field state and validation live in the RHF form —
 * ClaimForm); this hook owns navigation and server errors.
 */
export function useClaimForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlToken = searchParams.get('token') ?? '';

  const [errorState, setErrorState] = useState<{ message: string; isGone: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (input: ClaimRequest) => {
    setErrorState(null);
    setSubmitting(true);
    try {
      await claimTokenAction(input);
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
    urlToken,
    hasTokenFromUrl: urlToken.length > 0,
    errorState,
    submitting,
    handleSubmit,
  };
}
