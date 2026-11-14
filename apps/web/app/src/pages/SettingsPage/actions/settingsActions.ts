import { authApi } from '../../../api/endpoints/auth';
import { tokensApi } from '../../../api/endpoints/tokens';
import { toApiError } from '../../../api/schemas/problem';
import type { CreatePersonalAccessTokenInput } from '../../../api/schemas/tokens';
import { useUiStore } from '../../../stores/uiStore';
import { SETTINGS_PAGE_STRINGS as S } from '../strings';

export async function changePasswordAction(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<boolean> {
  try {
    await authApi.changePassword(input);
    useUiStore.getState().enqueueSnackbar({
      message: S.profile.successToast,
      severity: 'success',
    });
    return true;
  } catch (err) {
    useUiStore.getState().enqueueSnackbar({
      message: toApiError(err).detail,
      severity: 'error',
    });
    return false;
  }
}

export async function createTokenAction(
  input: CreatePersonalAccessTokenInput,
): Promise<{ token: string } | null> {
  try {
    const created = await tokensApi.create(input);
    useUiStore.getState().enqueueSnackbar({
      message: S.tokens.createdToast(created.name),
      severity: 'success',
    });
    return { token: created.token };
  } catch (err) {
    useUiStore.getState().enqueueSnackbar({
      message: toApiError(err).detail,
      severity: 'error',
    });
    return null;
  }
}

export async function revokeTokenAction(tokenId: string): Promise<boolean> {
  try {
    await tokensApi.revoke(tokenId);
    useUiStore.getState().enqueueSnackbar({
      message: S.tokens.revokedToast,
      severity: 'success',
    });
    return true;
  } catch (err) {
    useUiStore.getState().enqueueSnackbar({
      message: toApiError(err).detail,
      severity: 'error',
    });
    return false;
  }
}
