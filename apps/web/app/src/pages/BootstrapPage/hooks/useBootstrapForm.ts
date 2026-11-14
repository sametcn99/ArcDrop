import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { bootstrapRequestSchema } from '../../../api/schemas/auth';
import { isApiError } from '../../../api/schemas/problem';
import { bootstrapInstanceAction } from '../actions/bootstrapActions';
import { BOOTSTRAP_PAGE_STRINGS } from '../strings';

export interface BootstrapFieldErrors {
  email?: string;
  password?: string;
  confirmPassword?: string;
}

export function useBootstrapForm() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<BootstrapFieldErrors>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [bootstrapClosed, setBootstrapClosed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (bootstrapClosed) return;

    setErrorMessage(null);
    const nextErrors: BootstrapFieldErrors = {};
    const parsed = bootstrapRequestSchema.safeParse({ email, password });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === 'email' && !nextErrors.email) nextErrors.email = issue.message;
        if (key === 'password' && !nextErrors.password) nextErrors.password = issue.message;
      }
    }
    if (password !== confirmPassword) {
      nextErrors.confirmPassword = BOOTSTRAP_PAGE_STRINGS.passwordMismatchError;
    }

    if (nextErrors.email || nextErrors.password || nextErrors.confirmPassword || !parsed.success) {
      setFieldErrors(nextErrors);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    try {
      await bootstrapInstanceAction(parsed.data);
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
    email,
    setEmail,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    fieldErrors,
    errorMessage,
    bootstrapClosed,
    submitting,
    handleSubmit,
  };
}
