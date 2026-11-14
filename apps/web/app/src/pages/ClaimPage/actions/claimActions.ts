import type { AuthSession, ClaimRequest } from '../../../api/schemas/auth';
import { useAuthStore } from '../../../stores/authStore';
import { useUiStore } from '../../../stores/uiStore';
import { CLAIM_PAGE_STRINGS } from '../strings';

export async function claimTokenAction(input: ClaimRequest): Promise<AuthSession> {
  const session = await useAuthStore.getState().claim(input);
  useUiStore.getState().enqueueSnackbar({
    message: CLAIM_PAGE_STRINGS.claimedSnackbar,
    severity: 'success',
  });
  return session;
}
