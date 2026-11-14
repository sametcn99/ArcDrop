import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { BootstrapRequest } from '../../../api/schemas/auth';
import { isApiError } from '../../../api/schemas/problem';
import { bootstrapInstanceAction } from '../actions/bootstrapActions';

/**
 * Bootstrap orchestration (field state and validation live in the RHF form —
 * BootstrapForm); this hook owns navigation and server errors.
 */
export function useBootstrapForm() {
  const navigate = useNavigate();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [bootstrapClosed, setBootstrapClosed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (input: BootstrapRequest) => {
    if (bootstrapClosed) return;

    setErrorMessage(null);
    setSubmitting(true);
    try {
      await bootstrapInstanceAction(input);
      navigate('/', { replace: true });
    } catch (err) {
      if (isApiError(err) && (err.status === 409 || err.code === 'CONFLICT')) {
        setBootstrapClosed(true);
        setErrorMessage(err.detail);
      } else {
        setErrorMessage(isApiError(err) ? err.detail : 'Initial setup failed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return {
    errorMessage,
    bootstrapClosed,
    submitting,
    handleSubmit,
  };
}
