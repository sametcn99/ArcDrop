import { apiClient, type ApiClient } from '../client';
import {
  authSessionSchema,
  sessionListSchema,
  tfaEnableResponseSchema,
  tfaSetupResponseSchema,
  userSchema,
  type AuthSession,
  type BootstrapRequest,
  type ChangePasswordRequest,
  type ClaimRequest,
  type LoginOutcome,
  type LoginRequest,
  type LoginTfaRequest,
  type RegisterRequest,
  type Session,
  type TfaEnableResponse,
  type TfaSetupResponse,
  type User,
} from '../schemas/auth';
import { isTotpRequiredError } from '../schemas/problem';

export function createAuthApi(client: ApiClient = apiClient) {
  return {
    async bootstrap(input: BootstrapRequest): Promise<AuthSession> {
      return client.post('/auth/bootstrap', input, {
        schema: authSessionSchema,
        skipAuth: true,
      });
    },

    async login(input: LoginRequest): Promise<LoginOutcome> {
      try {
        const session = await client.post('/auth/login', input, {
          schema: authSessionSchema,
          skipAuth: true,
        });
        return { kind: 'authenticated', session };
      } catch (error) {
        if (isTotpRequiredError(error)) {
          return {
            kind: 'totp_required',
            challenge: error.problem.challenge,
            expiresAt: error.problem.expiresAt,
          };
        }
        throw error;
      }
    },

    async loginTfa(input: LoginTfaRequest): Promise<AuthSession> {
      return client.post('/auth/login/tfa', input, {
        schema: authSessionSchema,
        skipAuth: true,
      });
    },

    async refresh(refreshToken: string): Promise<AuthSession> {
      return client.post(
        '/auth/refresh',
        { refreshToken },
        {
          schema: authSessionSchema,
          skipAuth: true,
        },
      );
    },

    async logout(refreshToken: string): Promise<void> {
      await client.post<void>(
        '/auth/logout',
        { refreshToken },
        {
          skipAuth: true,
        },
      );
    },

    async claim(input: ClaimRequest): Promise<AuthSession> {
      return client.post('/auth/claim', input, {
        schema: authSessionSchema,
        skipAuth: true,
      });
    },

    async register(input: RegisterRequest): Promise<AuthSession> {
      return client.post('/auth/register', input, {
        schema: authSessionSchema,
        skipAuth: true,
      });
    },

    async getMe(): Promise<User> {
      return client.get('/auth/me', {
        schema: userSchema,
      });
    },

    async changePassword(input: ChangePasswordRequest): Promise<void> {
      await client.post<void>('/auth/password', input);
    },

    async listSessions(): Promise<Session[]> {
      return client.get('/auth/sessions', {
        schema: sessionListSchema,
      });
    },

    async revokeSession(sessionId: string): Promise<void> {
      await client.delete<void>(`/auth/sessions/${encodeURIComponent(sessionId)}`);
    },

    async setupTfa(): Promise<TfaSetupResponse> {
      return client.post('/auth/tfa/setup', undefined, {
        schema: tfaSetupResponseSchema,
      });
    },

    async enableTfa(code: string): Promise<TfaEnableResponse> {
      return client.post(
        '/auth/tfa/enable',
        { code },
        {
          schema: tfaEnableResponseSchema,
        },
      );
    },

    async disableTfa(input: { code?: string; recoveryCode?: string }): Promise<void> {
      await client.post<void>('/auth/tfa/disable', input);
    },
  };
}

export const authApi = createAuthApi();
