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

export const bookmarkArchiveSchema = z.object({
  bookmarkId: z.string(),
  cacheStatus: cacheStatusSchema,
  cacheCheckedAt: z.string().nullable(),
  html: z.string(),
  text: z.string(),
});

export const reindexBookmarkResponseSchema = z.object({
  id: z.string(),
  status: z.literal('scheduled'),
});

export const httpUrlSchema = z
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
  );

export const createBookmarkRequestSchema = z.object({
  url: httpUrlSchema.optional(),
  title: z.string().max(512).optional(),
  excerpt: z.string().max(4000).optional(),
  note: z.string().max(20000).optional(),
  favorite: z.boolean().default(false),
  reminderAt: z.string().nullable().optional(),
});

export const updateBookmarkRequestSchema = z.object({
  url: httpUrlSchema.optional(),
  title: z.string().max(512).nullable().optional(),
  excerpt: z.string().max(4000).nullable().optional(),
  note: z.string().max(20000).nullable().optional(),
  favorite: z.boolean().optional(),
  reminderAt: z.string().nullable().optional(),
});

export const replaceBookmarkTagsRequestSchema = z.object({
  tags: z.array(z.string().trim().min(1, 'Tag name cannot be empty').max(100)).max(50),
});

export const renameTagRequestSchema = z.object({
  name: z.string().trim().min(1, 'Tag name is required').max(100),
});

export const highlightSchema = z.object({
  id: z.string(),
  bookmarkId: z.string(),
  text: z.string(),
  note: z.string().nullable(),
  color: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const highlightListResponseSchema = z.object({
  items: z.array(highlightSchema),
});

export const createHighlightRequestSchema = z.object({
  text: z.string().trim().min(1, 'Highlight text is required').max(10000),
  note: z.string().max(10000).nullable().optional(),
  color: z.string().max(32).nullable().optional(),
});

export const updateHighlightRequestSchema = z.object({
  text: z.string().trim().min(1, 'Highlight text is required').max(10000).optional(),
  note: z.string().max(10000).nullable().optional(),
  color: z.string().max(32).nullable().optional(),
});

export const replaceBookmarkCollectionsRequestSchema = z.object({
  collectionIds: z.array(z.string()),
});

export const bookmarkCollectionRefSchema = z.object({
  id: z.string(),
  title: z.string(),
});

export const bookmarkCollectionsResponseSchema = z.object({
  collections: z.array(bookmarkCollectionRefSchema),
});

export const bulkBookmarkActionSchema = z.enum([
  'move',
  'addTags',
  'removeTags',
  'trash',
  'restore',
  'delete',
]);

export const bulkMoveModeSchema = z.enum(['assign', 'union']);

export const bulkBookmarksRequestSchema = z.object({
  action: bulkBookmarkActionSchema,
  ids: z.array(z.string()).min(1).max(500),
  mode: bulkMoveModeSchema.default('union'),
  collectionIds: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

export const bulkBookmarksResponseSchema = z.object({
  action: bulkBookmarkActionSchema,
  affected: z.number().int().nonnegative(),
  ids: z.array(z.string()),
});

export interface UploadBookmarkFileInput {
  file: File;
  title?: string;
  excerpt?: string;
  note?: string;
  favorite?: boolean;
  tags?: string[];
  collectionIds?: string[];
  reminderAt?: string | null;
}

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
export type BookmarkArchive = z.infer<typeof bookmarkArchiveSchema>;
export type ReindexBookmarkResponse = z.infer<typeof reindexBookmarkResponseSchema>;
export type CreateBookmarkRequest = z.infer<typeof createBookmarkRequestSchema>;
export type UpdateBookmarkRequest = z.infer<typeof updateBookmarkRequestSchema>;
export type ReplaceBookmarkTagsRequest = z.infer<typeof replaceBookmarkTagsRequestSchema>;
export type RenameTagRequest = z.infer<typeof renameTagRequestSchema>;
export type Highlight = z.infer<typeof highlightSchema>;
export type HighlightListResponse = z.infer<typeof highlightListResponseSchema>;
export type CreateHighlightRequest = z.infer<typeof createHighlightRequestSchema>;
export type UpdateHighlightRequest = z.infer<typeof updateHighlightRequestSchema>;
export type ReplaceBookmarkCollectionsRequest = z.infer<
  typeof replaceBookmarkCollectionsRequestSchema
>;
export type BookmarkCollectionRef = z.infer<typeof bookmarkCollectionRefSchema>;
export type BookmarkCollectionsResponse = z.infer<typeof bookmarkCollectionsResponseSchema>;
export type BulkBookmarkAction = z.infer<typeof bulkBookmarkActionSchema>;
export type BulkMoveMode = z.infer<typeof bulkMoveModeSchema>;
export type BulkBookmarksRequest = z.input<typeof bulkBookmarksRequestSchema>;
export type BulkBookmarksResponse = z.infer<typeof bulkBookmarksResponseSchema>;

export type BookmarkListQuery = NonNullable<operations['listBookmarks']['parameters']['query']>;
export type CreateBookmarkQuery = NonNullable<operations['createBookmark']['parameters']['query']>;

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
const _bookmarkArchiveCheck: components['schemas']['BookmarkArchiveDto'] | undefined = undefined as
  BookmarkArchive | undefined;
const _reindexBookmarkCheck: components['schemas']['ReindexBookmarkResponseDto'] | undefined =
  undefined as ReindexBookmarkResponse | undefined;
const _createBookmarkCheck: components['schemas']['CreateBookmarkBodyDto'] | undefined =
  undefined as CreateBookmarkRequest | undefined;
const _updateBookmarkCheck: components['schemas']['UpdateBookmarkDto'] | undefined = undefined as
  UpdateBookmarkRequest | undefined;
const _replaceTagsCheck: components['schemas']['ReplaceBookmarkTagsDto'] | undefined = undefined as
  ReplaceBookmarkTagsRequest | undefined;
const _renameTagCheck: components['schemas']['RenameTagDto'] | undefined = undefined as
  RenameTagRequest | undefined;
const _highlightCheck: components['schemas']['HighlightDto'] | undefined = undefined as
  Highlight | undefined;
const _highlightListCheck: components['schemas']['HighlightListDto'] | undefined = undefined as
  HighlightListResponse | undefined;
const _createHighlightCheck: components['schemas']['CreateHighlightDto'] | undefined = undefined as
  CreateHighlightRequest | undefined;
const _updateHighlightCheck: components['schemas']['UpdateHighlightDto'] | undefined = undefined as
  UpdateHighlightRequest | undefined;
const _replaceCollectionsCheck: components['schemas']['ReplaceBookmarkCollectionsDto'] | undefined =
  undefined as ReplaceBookmarkCollectionsRequest | undefined;
const _bookmarkCollectionsCheck: components['schemas']['BookmarkCollectionsDto'] | undefined =
  undefined as BookmarkCollectionsResponse | undefined;
const _bulkBookmarksCheck: components['schemas']['BulkBookmarksDto'] | undefined = undefined as
  z.infer<typeof bulkBookmarksRequestSchema> | undefined;
const _bulkBookmarksResponseCheck: components['schemas']['BulkBookmarksResponseDto'] | undefined =
  undefined as BulkBookmarksResponse | undefined;
void _urlPartsCheck;
void _tagCheck;
void _tagUsageCheck;
void _bookmarkCheck;
void _bookmarkListCheck;
void _bookmarkStatsCheck;
void _bookmarkArchiveCheck;
void _reindexBookmarkCheck;
void _createBookmarkCheck;
void _updateBookmarkCheck;
void _replaceTagsCheck;
void _renameTagCheck;
void _highlightCheck;
void _highlightListCheck;
void _createHighlightCheck;
void _updateHighlightCheck;
void _replaceCollectionsCheck;
void _bookmarkCollectionsCheck;
void _bulkBookmarksCheck;
void _bulkBookmarksResponseCheck;
