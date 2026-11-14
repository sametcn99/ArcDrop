import { z } from 'zod';
import type { components, operations } from '../types';

export const collectionShareSchema = z.object({
  enabled: z.boolean(),
  shareToken: z.string().nullable(),
});

export const collectionSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  title: z.string(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  order: z.number(),
  bookmarkCount: z.number().int().nonnegative(),
  share: collectionShareSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CollectionShare = z.infer<typeof collectionShareSchema>;
export type Collection = z.infer<typeof collectionSchema>;

export interface CollectionNode extends Collection {
  children: CollectionNode[];
}

export const collectionNodeSchema: z.ZodType<CollectionNode> = collectionSchema.extend({
  children: z.lazy(() => z.array(collectionNodeSchema)),
});

export const collectionTreeResponseSchema = z.array(collectionNodeSchema);

export const collectionListResponseSchema = z.object({
  items: z.array(collectionSchema),
});

export const collectionSnapshotSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  title: z.string(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  order: z.number(),
  share: collectionShareSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});

export const createCollectionRequestSchema = z.object({
  title: z.string().trim().min(1, 'Collection title is required').max(255),
  icon: z.string().max(255).optional(),
  color: z.string().max(32).optional(),
  parentId: z.string().nullable().optional(),
});

export const updateCollectionRequestSchema = z.object({
  title: z.string().trim().min(1, 'Collection title is required').max(255).optional(),
  icon: z.string().max(255).nullable().optional(),
  color: z.string().max(32).nullable().optional(),
  parentId: z.string().nullable().optional(),
});

export const updateCollectionShareRequestSchema = z.object({
  enabled: z.boolean(),
});

export const collectionShareResponseSchema = z.object({
  collectionId: z.string(),
  enabled: z.boolean(),
  shareToken: z.string().nullable(),
  publicPath: z.string().nullable(),
  rssPath: z.string().nullable(),
});

export const collectionOrderItemSchema = z.object({
  id: z.string(),
  order: z.number().int().nonnegative(),
});

export const reorderCollectionsRequestSchema = z.object({
  items: z.array(collectionOrderItemSchema).min(1),
});

export const bookmarkOrderItemSchema = z.object({
  bookmarkId: z.string(),
  order: z.number().int().nonnegative(),
});

export const reorderCollectionBookmarksRequestSchema = z.object({
  items: z.array(bookmarkOrderItemSchema).min(1),
});

export const mergeCollectionsRequestSchema = z.object({
  sourceIds: z.array(z.string()).min(1),
  targetId: z.string(),
});

export const mergeCollectionsResponseSchema = z.object({
  target: collectionSchema,
  trashedIds: z.array(z.string()),
  movedChildren: z.number().int().nonnegative(),
  movedBookmarks: z.number().int().nonnegative(),
});

export const sortCollectionsResponseSchema = z.object({
  updated: z.number().int().nonnegative(),
});

export const deleteEmptyCollectionsResponseSchema = z.object({
  trashed: z.number().int().nonnegative(),
  kept: z.number().int().nonnegative(),
});

export type CollectionListResponse = z.infer<typeof collectionListResponseSchema>;
export type CollectionSnapshot = z.infer<typeof collectionSnapshotSchema>;
export type CollectionListQuery = NonNullable<operations['listCollections']['parameters']['query']>;
export type CreateCollectionRequest = z.infer<typeof createCollectionRequestSchema>;
export type UpdateCollectionRequest = z.infer<typeof updateCollectionRequestSchema>;
export type UpdateCollectionShareRequest = z.infer<typeof updateCollectionShareRequestSchema>;
export type CollectionShareResponse = z.infer<typeof collectionShareResponseSchema>;
export type CollectionOrderItem = z.infer<typeof collectionOrderItemSchema>;
export type ReorderCollectionsRequest = z.infer<typeof reorderCollectionsRequestSchema>;
export type BookmarkOrderItem = z.infer<typeof bookmarkOrderItemSchema>;
export type ReorderCollectionBookmarksRequest = z.infer<
  typeof reorderCollectionBookmarksRequestSchema
>;
export type MergeCollectionsRequest = z.infer<typeof mergeCollectionsRequestSchema>;
export type MergeCollectionsResponse = z.infer<typeof mergeCollectionsResponseSchema>;
export type SortCollectionsResponse = z.infer<typeof sortCollectionsResponseSchema>;
export type DeleteEmptyCollectionsResponse = z.infer<typeof deleteEmptyCollectionsResponseSchema>;

// Compile-time structural alignment checks against generated OpenAPI schemas.
const _collectionShareCheck: components['schemas']['CollectionShareDto'] | undefined = undefined as
  CollectionShare | undefined;
const _collectionCheck: components['schemas']['CollectionDto'] | undefined = undefined as
  Collection | undefined;
const _collectionNodeCheck: components['schemas']['CollectionNodeDto'] | undefined = undefined as
  CollectionNode | undefined;
const _collectionListCheck: components['schemas']['CollectionListDto'] | undefined = undefined as
  CollectionListResponse | undefined;
const _collectionSnapshotCheck: components['schemas']['CollectionSnapshotDto'] | undefined =
  undefined as CollectionSnapshot | undefined;
const _createCollectionCheck: components['schemas']['CreateCollectionDto'] | undefined =
  undefined as CreateCollectionRequest | undefined;
const _updateCollectionCheck: components['schemas']['UpdateCollectionDto'] | undefined =
  undefined as UpdateCollectionRequest | undefined;
const _updateCollectionShareCheck: components['schemas']['UpdateCollectionShareDto'] | undefined =
  undefined as UpdateCollectionShareRequest | undefined;
const _collectionShareResponseCheck:
  components['schemas']['CollectionShareResponseDto'] | undefined = undefined as
  CollectionShareResponse | undefined;
const _reorderCollectionsCheck: components['schemas']['ReorderCollectionsDto'] | undefined =
  undefined as ReorderCollectionsRequest | undefined;
const _reorderCollectionBookmarksCheck:
  components['schemas']['ReorderCollectionBookmarksDto'] | undefined = undefined as
  ReorderCollectionBookmarksRequest | undefined;
const _mergeCollectionsCheck: components['schemas']['MergeCollectionsDto'] | undefined =
  undefined as MergeCollectionsRequest | undefined;
const _mergeCollectionsResponseCheck:
  components['schemas']['MergeCollectionsResponseDto'] | undefined = undefined as
  MergeCollectionsResponse | undefined;
const _sortCollectionsResponseCheck:
  components['schemas']['SortCollectionsResponseDto'] | undefined = undefined as
  SortCollectionsResponse | undefined;
const _deleteEmptyCollectionsResponseCheck:
  components['schemas']['DeleteEmptyCollectionsResponseDto'] | undefined = undefined as
  DeleteEmptyCollectionsResponse | undefined;

void _collectionShareCheck;
void _collectionCheck;
void _collectionNodeCheck;
void _collectionListCheck;
void _collectionSnapshotCheck;
void _createCollectionCheck;
void _updateCollectionCheck;
void _updateCollectionShareCheck;
void _collectionShareResponseCheck;
void _reorderCollectionsCheck;
void _reorderCollectionBookmarksCheck;
void _mergeCollectionsCheck;
void _mergeCollectionsResponseCheck;
void _sortCollectionsResponseCheck;
void _deleteEmptyCollectionsResponseCheck;
