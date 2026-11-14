import { z } from 'zod';
import type { components } from '../types';

export const userRoleSchema = z.enum(['admin', 'user']);
export const userStatusSchema = z.enum(['active', 'disabled']);

export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: userRoleSchema,
  status: userStatusSchema,
  hasPassword: z.boolean(),
  totpEnabled: z.boolean(),
  createdAt: z.string(),
});

export const authSessionSchema = z.object({
  user: userSchema,
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
});

export const sessionSchema = z.object({
  id: z.string(),
  deviceLabel: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  current: z.boolean(),
  revokedAt: z.string().nullable(),
});

export const sessionListSchema = z.array(sessionSchema);

export const tfaSetupResponseSchema = z.object({
  secret: z.string(),
  otpauthUri: z.string(),
});

export const tfaEnableResponseSchema = z.object({
  recoveryCodes: z.array(z.string()),
});

export const loginRequestSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
  deviceLabel: z.string().max(200).optional(),
});

export const bootstrapRequestSchema = loginRequestSchema;
export const registerRequestSchema = loginRequestSchema;

export const claimRequestSchema = z.object({
  token: z.string().trim().min(1, 'Invite or reset token is required'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
  deviceLabel: z.string().max(200).optional(),
});

export const loginTfaRequestSchema = z
  .object({
    challenge: z.string().min(1),
    code: z.string().trim().min(1).max(32).optional(),
    recoveryCode: z.string().trim().min(1).max(64).optional(),
    deviceLabel: z.string().max(200).optional(),
  })
  .refine((val) => Boolean(val.code) !== Boolean(val.recoveryCode), {
    message: 'Provide either a TOTP code or a recovery code',
  });

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(8).max(128),
  newPassword: z.string().min(8).max(128),
});

export type User = z.infer<typeof userSchema>;
export type AuthSession = z.infer<typeof authSessionSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type TfaSetupResponse = z.infer<typeof tfaSetupResponseSchema>;
export type TfaEnableResponse = z.infer<typeof tfaEnableResponseSchema>;

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type BootstrapRequest = z.infer<typeof bootstrapRequestSchema>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type ClaimRequest = z.infer<typeof claimRequestSchema>;
export type LoginTfaRequest = z.infer<typeof loginTfaRequestSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export type LoginOutcome =
  | { kind: 'authenticated'; session: AuthSession }
  | { kind: 'totp_required'; challenge: string; expiresAt: string };

// Compile-time structural alignment checks against generated OpenAPI schemas.
const _userCheck: components['schemas']['UserDto'] | undefined = undefined as User | undefined;
const _authSessionCheck: components['schemas']['AuthSessionResponseDto'] | undefined = undefined as
  AuthSession | undefined;
const _sessionCheck: components['schemas']['SessionDto'] | undefined = undefined as
  Session | undefined;
const _tfaSetupCheck: components['schemas']['TfaSetupResponseDto'] | undefined = undefined as
  TfaSetupResponse | undefined;
const _tfaEnableCheck: components['schemas']['TfaEnableResponseDto'] | undefined = undefined as
  TfaEnableResponse | undefined;
void _userCheck;
void _authSessionCheck;
void _sessionCheck;
void _tfaSetupCheck;
void _tfaEnableCheck;
