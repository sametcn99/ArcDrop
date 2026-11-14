import type { AuthSession, BootstrapRequest } from '../../../api/schemas/auth';
import { useAuthStore } from '../../../stores/authStore';
import { useUiStore } from '../../../stores/uiStore';
import { BOOTSTRAP_PAGE_STRINGS } from '../strings';

export async function bootstrapInstanceAction(input: BootstrapRequest): Promise<AuthSession> {
  const session = await useAuthStore.getState().bootstrap(input);
  useUiStore.getState().enqueueSnackbar({
    message: BOOTSTRAP_PAGE_STRINGS.bootstrappedSnackbar,
    severity: 'success',
  });
  return session;
}
