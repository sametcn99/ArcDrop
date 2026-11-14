import { z } from 'zod';
import type { components, operations } from '../types';

export const contentTypeSchema = z.enum([
  'article',
  'image',
  'video',
  'audio',
  'document',
  'book',
  'link',
]);

export const cacheStatusSchema = z.enum([
  'pending',
  'ready',
  'failed',
  'invalid-origin',
  'skipped',
]);

export const storageKindSchema = z.enum(['url', 'file']);

export const bookmarkSortSchema = z.enum(['updated', 'created', 'title', 'manual']);

export const bookmarkUrlPartsSchema = z.object({
  scheme: z.string(),
  host: z.string(),
  domain: z.string().nullable(),
  port: z.string().nullable(),
  path: z.string(),
  query: z.string().nullable(),
  fragment: z.string().nullable(),
});

export const tagSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const tagUsageSchema = z.object({
  id: z.string(),
  name: z.string(),
  count: z.number().int().nonnegative(),
});

export const tagUsageListSchema = z.array(tagUsageSchema);

export const bookmarkSchema = z.object({
  id: z.string(),
  storageKind: storageKindSchema,
  url: z.string().nullable(),
  title: z.string().nullable(),
  excerpt: z.string().nullable(),
  note: z.string().nullable(),
  favorite: z.boolean(),
  contentType: contentTypeSchema,
  coverRef: z.string().nullable(),
  iconRef: z.string().nullable(),
  urlParts: bookmarkUrlPartsSchema.nullable(),
  fileRef: z.string().nullable(),
  fileName: z.string().nullable(),
  fileMime: z.string().nullable(),
  fileSize: z.number().nullable(),
  tags: z.array(tagSummarySchema),
  lastCheckedAt: z.string().nullable(),
  brokenReason: z.string().nullable(),
  brokenAt: z.string().nullable(),
  reminderAt: z.string().nullable(),
  remindedAt: z.string().nullable(),
  cacheStatus: cacheStatusSchema,
  cacheCheckedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});

export const bookmarkListResponseSchema = z.object({
  items: z.array(bookmarkSchema),
  totalCount: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

export const bookmarkStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  unassigned: z.number().int().nonnegative(),
  trashed: z.number().int().nonnegative(),
  favorites: z.number().int().nonnegative(),
});

export const updateBookmarkRequestSchema = z.object({
  url: z
    .string()
    .trim()
    .url('Enter a valid http(s) URL')
    .refine(
      (val) => {
        try {
          const parsed = new URL(val);
          return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
          return false;
        }
      },
      { message: 'URL must use http or https scheme' },
    )
    .optional(),
  title: z.string().max(512).nullable().optional(),
  excerpt: z.string().max(4000).nullable().optional(),
  note: z.string().max(20000).nullable().optional(),
  favorite: z.boolean().optional(),
  reminderAt: z.string().nullable().optional(),
});

export type BookmarkContentType = z.infer<typeof contentTypeSchema>;
export type BookmarkCacheStatus = z.infer<typeof cacheStatusSchema>;
export type BookmarkStorageKind = z.infer<typeof storageKindSchema>;
export type BookmarkSort = z.infer<typeof bookmarkSortSchema>;
export type BookmarkUrlParts = z.infer<typeof bookmarkUrlPartsSchema>;
export type TagSummary = z.infer<typeof tagSummarySchema>;
export type TagUsage = z.infer<typeof tagUsageSchema>;
export type Bookmark = z.infer<typeof bookmarkSchema>;
export type BookmarkListResponse = z.infer<typeof bookmarkListResponseSchema>;
export type BookmarkStats = z.infer<typeof bookmarkStatsSchema>;
export type UpdateBookmarkRequest = z.infer<typeof updateBookmarkRequestSchema>;

export type BookmarkListQuery = NonNullable<operations['listBookmarks']['parameters']['query']>;

// Compile-time structural alignment checks against generated OpenAPI schemas.
const _urlPartsCheck: components['schemas']['BookmarkUrlPartsDto'] | undefined = undefined as
  BookmarkUrlParts | undefined;
const _tagCheck: components['schemas']['TagDto'] | undefined = undefined as TagSummary | undefined;
const _tagUsageCheck: components['schemas']['TagUsageDto'] | undefined = undefined as
  TagUsage | undefined;
const _bookmarkCheck: components['schemas']['BookmarkDto'] | undefined = undefined as
  Bookmark | undefined;
const _bookmarkListCheck: components['schemas']['BookmarkListDto'] | undefined = undefined as
  BookmarkListResponse | undefined;
const _bookmarkStatsCheck: components['schemas']['BookmarkStatsDto'] | undefined = undefined as
  BookmarkStats | undefined;
const _updateBookmarkCheck: components['schemas']['UpdateBookmarkDto'] | undefined = undefined as
  UpdateBookmarkRequest | undefined;
void _urlPartsCheck;
void _tagCheck;
void _tagUsageCheck;
void _bookmarkCheck;
void _bookmarkListCheck;
void _bookmarkStatsCheck;
void _updateBookmarkCheck;
