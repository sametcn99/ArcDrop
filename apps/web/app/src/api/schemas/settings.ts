import { z } from 'zod';
import type { components } from '../types';

export const brokenLinkCheckModeSchema = z.enum(['off', 'basic', 'default', 'strict']);

export const settingsSchema = z.object({
  registrationOpen: z.boolean(),
  trashRetentionDays: z.number().int().positive(),
  changeLogRetentionDays: z.number().int().positive(),
  brokenLinkCheckMode: brokenLinkCheckModeSchema,
  archiveMaxBytes: z.number().int().positive(),
  fileMaxBytes: z.number().int().positive(),
  monthlyUploadQuotaBytes: z.number().int().positive(),
});

export type BrokenLinkCheckMode = z.infer<typeof brokenLinkCheckModeSchema>;
export type Settings = z.infer<typeof settingsSchema>;

// Compile-time structural alignment checks against generated OpenAPI schemas.
const _settingsCheck: components['schemas']['SettingsDto'] | undefined = undefined as
  Settings | undefined;
void _settingsCheck;
