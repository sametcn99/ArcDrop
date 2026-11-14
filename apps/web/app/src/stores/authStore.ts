import { create } from 'zustand';
import { apiClient } from '../api/client';
import { authApi } from '../api/endpoints/auth';
import type {
  AuthSession,
  BootstrapRequest,
  ClaimRequest,
  LoginOutcome,
  LoginRequest,
  User,
} from '../api/schemas/auth';
import { toApiError, type ApiError } from '../api/schemas/problem';
import { syncEngine } from '../api/sync-engine';
import { useLibraryStore } from './libraryStore';
import { useSyncStore } from './syncStore';
import { useUiStore } from './uiStore';

export type AuthStatus =
  'unauthenticated' | 'restoring' | 'authenticating' | 'totp_required' | 'authenticated';

export interface TfaChallengeState {
  challenge: string;
  expiresAt: string;
  email: string;
}

export interface CompleteTfaInput {
  code?: string;
  recoveryCode?: string;
  deviceLabel?: string;
}

export interface AuthState {
  user: User | null;
  status: AuthStatus;
  tfaChallenge: TfaChallengeState | null;
  error: ApiError | null;
  login: (input: LoginRequest) => Promise<LoginOutcome>;
  completeTfa: (input: CompleteTfaInput) => Promise<AuthSession>;
  cancelTfa: () => void;
  bootstrap: (input: BootstrapRequest) => Promise<AuthSession>;
  claim: (input: ClaimRequest) => Promise<AuthSession>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<boolean>;
  refreshProfile: () => Promise<User>;
  setSession: (session: AuthSession) => void;
  clearError: () => void;
  reset: () => void;
}

function clearClientDataStores() {
  syncEngine.stop();
  useSyncStore.getState().reset();
  useLibraryStore.getState().reset();
}

function attachClientHooks() {
  apiClient.setHooks({
    onSessionRefreshed(session) {
      useAuthStore.setState({
        user: session.user,
        status: 'authenticated',
        tfaChallenge: null,
        error: null,
      });
    },
    onSessionExpired(error) {
      clearClientDataStores();
      // Also drop the persisted refresh token — the API has revoked its
      // family (reuse detection) or it expired, so it can never restore.
      apiClient.clearTokens();
      useAuthStore.setState({
        user: null,
        status: 'unauthenticated',
        tfaChallenge: null,
        error,
      });
      useUiStore.getState().enqueueSnackbar({
        message: error.detail || 'Your session expired. Please sign in again.',
        severity: 'warning',
      });
    },
  });
}

// Single-flight guard: concurrent restore calls (React StrictMode double
// effects, rapid mounts) must not replay the same refresh token twice — the
// API rotates refresh tokens and revokes the family on reuse.
let restoreSessionInFlight: Promise<boolean> | null = null;

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  status: 'unauthenticated',
  tfaChallenge: null,
  error: null,

  setSession(session) {
    apiClient.setTokens({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    });
    set({
      user: session.user,
      status: 'authenticated',
      tfaChallenge: null,
      error: null,
    });
  },

  async login(input) {
    set({ status: 'authenticating', error: null });
    try {
      const outcome = await authApi.login(input);
      if (outcome.kind === 'totp_required') {
        set({
          status: 'totp_required',
          tfaChallenge: {
            challenge: outcome.challenge,
            expiresAt: outcome.expiresAt,
            email: input.email,
          },
          error: null,
        });
        return outcome;
      }

      get().setSession(outcome.session);
      return outcome;
    } catch (err) {
      const apiError = toApiError(err);
      set({
        user: null,
        status: 'unauthenticated',
        tfaChallenge: null,
        error: apiError,
      });
      throw apiError;
    }
  },

  async completeTfa(input) {
    const activeChallenge = get().tfaChallenge;
    if (!activeChallenge) {
      const missingChallengeError = toApiError(new Error('No active two-factor challenge'));
      set({ status: 'unauthenticated', error: missingChallengeError });
      throw missingChallengeError;
    }

    set({ status: 'authenticating', error: null });
    try {
      const session = await authApi.loginTfa({
        challenge: activeChallenge.challenge,
        code: input.code,
        recoveryCode: input.recoveryCode,
        deviceLabel: input.deviceLabel,
      });
      get().setSession(session);
      return session;
    } catch (err) {
      const apiError = toApiError(err);
      set({
        status: 'totp_required',
        error: apiError,
      });
      throw apiError;
    }
  },

  cancelTfa() {
    set({
      status: 'unauthenticated',
      tfaChallenge: null,
      error: null,
    });
  },

  async bootstrap(input) {
    set({ status: 'authenticating', error: null });
    try {
      const session = await authApi.bootstrap(input);
      get().setSession(session);
      return session;
    } catch (err) {
      const apiError = toApiError(err);
      set({
        user: null,
        status: 'unauthenticated',
        tfaChallenge: null,
        error: apiError,
      });
      throw apiError;
    }
  },

  async claim(input) {
    set({ status: 'authenticating', error: null });
    try {
      const session = await authApi.claim(input);
      get().setSession(session);
      return session;
    } catch (err) {
      const apiError = toApiError(err);
      set({
        user: null,
        status: 'unauthenticated',
        tfaChallenge: null,
        error: apiError,
      });
      throw apiError;
    }
  },

  async logout() {
    const refreshToken = apiClient.getRefreshToken();
    clearClientDataStores();
    try {
      if (refreshToken) {
        await authApi.logout(refreshToken);
      }
    } catch {
      // Logout is idempotent and must always clear client-side session state.
    } finally {
      apiClient.clearTokens();
      set({
        user: null,
        status: 'unauthenticated',
        tfaChallenge: null,
        error: null,
      });
    }
  },

  restoreSession() {
    if (restoreSessionInFlight) {
      return restoreSessionInFlight;
    }

    const persisted = apiClient.getPersistedRefreshToken();
    if (!persisted) {
      set({ status: 'unauthenticated' });
      return Promise.resolve(false);
    }

    set({ status: 'restoring', error: null });
    restoreSessionInFlight = (async () => {
      try {
        // The API rotates the refresh token on every use; setSession persists
        // the new one for the next reload.
        const session = await authApi.refresh(persisted);
        get().setSession(session);
        return true;
      } catch {
        apiClient.clearTokens();
        set({
          user: null,
          status: 'unauthenticated',
          tfaChallenge: null,
          error: null,
        });
        return false;
      } finally {
        restoreSessionInFlight = null;
      }
    })();
    return restoreSessionInFlight;
  },

  async refreshProfile() {
    const user = await authApi.getMe();
    set({ user, status: 'authenticated' });
    return user;
  },

  clearError() {
    set({ error: null });
  },

  reset() {
    clearClientDataStores();
    apiClient.clearTokens();
    attachClientHooks();
    set({
      user: null,
      status: 'unauthenticated',
      tfaChallenge: null,
      error: null,
    });
  },
}));

attachClientHooks();
