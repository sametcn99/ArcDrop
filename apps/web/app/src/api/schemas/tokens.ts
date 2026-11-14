import { z } from 'zod';
import type { components } from '../types';

export const personalAccessTokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  readOnly: z.boolean(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});

export const personalAccessTokenListSchema = z.object({
  items: z.array(personalAccessTokenSchema),
});

export const createdPersonalAccessTokenSchema = personalAccessTokenSchema.extend({
  /** The raw token — shown exactly once, never retrievable again. */
  token: z.string(),
});

export const createPersonalAccessTokenInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name'),
  readOnly: z.boolean(),
});

export type PersonalAccessToken = z.infer<typeof personalAccessTokenSchema>;
export type CreatedPersonalAccessToken = z.infer<typeof createdPersonalAccessTokenSchema>;
export type CreatePersonalAccessTokenInput = z.infer<typeof createPersonalAccessTokenInputSchema>;

// Compile-time structural alignment checks against generated OpenAPI schemas.
const _patCheck: components['schemas']['PersonalAccessTokenDto'] | undefined = undefined as
  PersonalAccessToken | undefined;
const _createdPatCheck: components['schemas']['CreatedPersonalAccessTokenDto'] | undefined =
  undefined as CreatedPersonalAccessToken | undefined;
void _patCheck;
void _createdPatCheck;
