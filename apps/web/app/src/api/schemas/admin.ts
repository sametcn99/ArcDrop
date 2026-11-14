import { z } from 'zod';
import type { components } from '../types';
import { userSchema, type User } from './auth';

export const oneTimeTokenSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
});

export const userListSchema = z.object({
  items: z.array(userSchema),
});

export const createUserResponseSchema = z.object({
  user: userSchema,
  invite: oneTimeTokenSchema,
});

export const resetPasswordResponseSchema = z.object({
  reset: oneTimeTokenSchema,
});

export const auditLogEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  actorType: z.enum(['jwt', 'pat']),
  userId: z.string(),
  patId: z.string().nullable(),
  requestId: z.string().nullable(),
  subject: z.string().nullable(),
  outcome: z.enum(['ok', 'error']),
  detail: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
});

export const auditLogListSchema = z.object({
  items: z.array(auditLogEntrySchema),
  totalCount: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export type OneTimeToken = z.infer<typeof oneTimeTokenSchema>;
export type CreateUserResponse = z.infer<typeof createUserResponseSchema>;
export type ResetPasswordResponse = z.infer<typeof resetPasswordResponseSchema>;
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;
export type AuditLogList = z.infer<typeof auditLogListSchema>;
export type { User };

export interface AuditLogFilters {
  action?: string;
  actorType?: 'jwt' | 'pat';
  actorUserId?: string;
  outcome?: 'ok' | 'error';
  subject?: string;
  since?: string;
  until?: string;
  page?: number;
  pageSize?: number;
}

// Compile-time structural alignment checks against generated OpenAPI schemas.
const _entryCheck: components['schemas']['AuditLogEntryDto'] | undefined = undefined as
  AuditLogEntry | undefined;
const _inviteCheck: components['schemas']['OneTimeTokenDto'] | undefined = undefined as
  OneTimeToken | undefined;
void _entryCheck;
void _inviteCheck;
