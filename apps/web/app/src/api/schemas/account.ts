import { z } from 'zod';
import type { components } from '../types';

/**
 * Password-confirmation body for the self-service account lifecycle
 * endpoints (`POST /me/reset-data`, `DELETE /me`).
 */
export const confirmPasswordRequestSchema = z.object({
  password: z.string().min(1, 'Enter your password'),
});

export type ConfirmPasswordRequest = z.infer<typeof confirmPasswordRequestSchema>;

// Compile-time structural alignment check against the generated OpenAPI schema.
const _confirmPasswordCheck: components['schemas']['ConfirmPasswordDto'] | undefined = undefined as
  ConfirmPasswordRequest | undefined;
void _confirmPasswordCheck;
