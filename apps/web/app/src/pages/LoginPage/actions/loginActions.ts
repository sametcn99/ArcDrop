import type { AuthSession, LoginOutcome, LoginRequest } from '../../../api/schemas/auth';
import { useAuthStore, type CompleteTfaInput } from '../../../stores/authStore';
import { useUiStore } from '../../../stores/uiStore';
import { LOGIN_PAGE_STRINGS } from '../strings';

export async function submitCredentialsAction(input: LoginRequest): Promise<LoginOutcome> {
  const outcome = await useAuthStore.getState().login(input);
  if (outcome.kind === 'authenticated') {
    useUiStore.getState().enqueueSnackbar({
      message: LOGIN_PAGE_STRINGS.signedInSnackbar,
      severity: 'success',
    });
  }
  return outcome;
}

export async function submitTotpAction(input: CompleteTfaInput): Promise<AuthSession> {
  const session = await useAuthStore.getState().completeTfa(input);
  useUiStore.getState().enqueueSnackbar({
    message: LOGIN_PAGE_STRINGS.signedInSnackbar,
    severity: 'success',
  });
  return session;
}

export function cancelTotpAction(): void {
  useAuthStore.getState().cancelTfa();
}
