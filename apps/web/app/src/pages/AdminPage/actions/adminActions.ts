import { adminApi } from '../../../api/endpoints/admin';
import { settingsApi } from '../../../api/endpoints/settings';
import type { OneTimeToken } from '../../../api/schemas/admin';
import type { Settings } from '../../../api/schemas/settings';
import { toApiError } from '../../../api/schemas/problem';
import { useUiStore } from '../../../stores/uiStore';
import { ADMIN_PAGE_STRINGS as S } from '../strings';

export interface CreateUserResult {
  ok: boolean;
  invite?: OneTimeToken;
}

export async function createUserAction(input: {
  email: string;
  role: 'admin' | 'user';
}): Promise<CreateUserResult> {
  try {
    const response = await adminApi.createUser(input);
    useUiStore.getState().enqueueSnackbar({
      message: S.users.createdToast(response.user.email),
      severity: 'success',
    });
    return { ok: true, invite: response.invite };
  } catch (err) {
    useUiStore.getState().enqueueSnackbar({
      message: toApiError(err).detail,
      severity: 'error',
    });
    return { ok: false };
  }
}

export async function updateUserStatusAction(
  userId: string,
  status: 'active' | 'disabled',
  email: string,
): Promise<boolean> {
  try {
    await adminApi.updateUser(userId, { status });
    useUiStore.getState().enqueueSnackbar({
      message: S.users.statusToast(email, status),
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

export async function resetUserPasswordAction(
  userId: string,
  email: string,
): Promise<OneTimeToken | null> {
  try {
    const response = await adminApi.resetUserPassword(userId);
    useUiStore.getState().enqueueSnackbar({
      message: S.users.resetToast(email),
      severity: 'success',
    });
    return response.reset;
  } catch (err) {
    useUiStore.getState().enqueueSnackbar({
      message: toApiError(err).detail,
      severity: 'error',
    });
    return null;
  }
}

export async function saveSettingsAction(input: Settings): Promise<boolean> {
  try {
    await settingsApi.update(input);
    useUiStore.getState().enqueueSnackbar({
      message: S.settings.savedToast,
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
