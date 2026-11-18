import type { AuthSession, LoginOutcome, LoginRequest } from '../../../api/schemas/auth';
import { platform } from '../../../platform';
import { useAuthStore, type CompleteTfaInput } from '../../../stores/authStore';
import { useUiStore } from '../../../stores/uiStore';
import { LOGIN_PAGE_STRINGS } from '../strings';

export async function submitCredentialsAction(input: LoginRequest): Promise<LoginOutcome> {
  // Session listing benefits from a native device label when one is
  // available (plan T2); plain browsers keep the API-derived behavior.
  const deviceLabel = input.deviceLabel ?? (await platform.resolveDeviceLabel()) ?? undefined;
  const outcome = await useAuthStore.getState().login({ ...input, deviceLabel });
  if (outcome.kind === 'authenticated') {
    useUiStore.getState().enqueueSnackbar({
      message: LOGIN_PAGE_STRINGS.signedInSnackbar,
      severity: 'success',
    });
  }
  return outcome;
}

export async function submitTotpAction(input: CompleteTfaInput): Promise<AuthSession> {
  const deviceLabel = input.deviceLabel ?? (await platform.resolveDeviceLabel()) ?? undefined;
  const session = await useAuthStore.getState().completeTfa({ ...input, deviceLabel });
  useUiStore.getState().enqueueSnackbar({
    message: LOGIN_PAGE_STRINGS.signedInSnackbar,
    severity: 'success',
  });
  return session;
}

export function cancelTotpAction(): void {
  useAuthStore.getState().cancelTfa();
}
