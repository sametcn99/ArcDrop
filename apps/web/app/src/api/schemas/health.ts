import { z } from 'zod';
import type { components } from '../types';
import { bookmarkSchema } from './bookmarks';

export const duplicateGroupSchema = z.object({
  normalizedUrl: z.string(),
  original: bookmarkSchema,
  extras: z.array(bookmarkSchema),
});

export const duplicateGroupsResponseSchema = z.object({
  groups: z.array(duplicateGroupSchema),
});

export const resolveDuplicatesRequestSchema = z.object({
  keepId: z.string(),
  trashIds: z.array(z.string()).min(1).max(200),
});

export const resolveDuplicatesResponseSchema = z.object({
  kept: bookmarkSchema,
  trashedIds: z.array(z.string()),
});

export type DuplicateGroup = z.infer<typeof duplicateGroupSchema>;
export type DuplicateGroupsResponse = z.infer<typeof duplicateGroupsResponseSchema>;
export type ResolveDuplicatesRequest = z.infer<typeof resolveDuplicatesRequestSchema>;
export type ResolveDuplicatesResponse = z.infer<typeof resolveDuplicatesResponseSchema>;

// Compile-time structural alignment checks against generated OpenAPI schemas.
const _duplicateGroupCheck: components['schemas']['DuplicateGroupDto'] | undefined = undefined as
  DuplicateGroup | undefined;
const _duplicateGroupsResponseCheck:
  | components['schemas']['DuplicateGroupsResponseDto']
  | undefined = undefined as DuplicateGroupsResponse | undefined;
const _resolveDuplicatesRequestCheck: components['schemas']['ResolveDuplicatesDto'] | undefined =
  undefined as ResolveDuplicatesRequest | undefined;
const _resolveDuplicatesResponseCheck:
  | components['schemas']['ResolveDuplicatesResponseDto']
  | undefined = undefined as ResolveDuplicatesResponse | undefined;
void _duplicateGroupCheck;
void _duplicateGroupsResponseCheck;
void _resolveDuplicatesRequestCheck;
void _resolveDuplicatesResponseCheck;
