import type { AuthSession, BootstrapRequest } from '../../../api/schemas/auth';
import { platform } from '../../../platform';
import { useAuthStore } from '../../../stores/authStore';
import { useUiStore } from '../../../stores/uiStore';
import { BOOTSTRAP_PAGE_STRINGS } from '../strings';

export async function bootstrapInstanceAction(input: BootstrapRequest): Promise<AuthSession> {
  // Session listing benefits from a native device label when one is
  // available (plan T2); plain browsers keep the API-derived behavior.
  const deviceLabel = input.deviceLabel ?? (await platform.resolveDeviceLabel()) ?? undefined;
  const session = await useAuthStore.getState().bootstrap({ ...input, deviceLabel });
  useUiStore.getState().enqueueSnackbar({
    message: BOOTSTRAP_PAGE_STRINGS.bootstrappedSnackbar,
    severity: 'success',
  });
  return session;
}
