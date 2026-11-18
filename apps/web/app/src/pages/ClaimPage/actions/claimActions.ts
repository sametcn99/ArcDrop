import type { AuthSession, ClaimRequest } from '../../../api/schemas/auth';
import { platform } from '../../../platform';
import { useAuthStore } from '../../../stores/authStore';
import { useUiStore } from '../../../stores/uiStore';
import { CLAIM_PAGE_STRINGS } from '../strings';

export async function claimTokenAction(input: ClaimRequest): Promise<AuthSession> {
  // Session listing benefits from a native device label when one is
  // available (plan T2); plain browsers keep the API-derived behavior.
  const deviceLabel = input.deviceLabel ?? (await platform.resolveDeviceLabel()) ?? undefined;
  const session = await useAuthStore.getState().claim({ ...input, deviceLabel });
  useUiStore.getState().enqueueSnackbar({
    message: CLAIM_PAGE_STRINGS.claimedSnackbar,
    severity: 'success',
  });
  return session;
}
