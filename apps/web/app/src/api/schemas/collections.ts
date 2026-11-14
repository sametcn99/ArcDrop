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

export type CollectionShare = z.infer<typeof collectionShareSchema>;
export type Collection = z.infer<typeof collectionSchema>;
export type CollectionListResponse = z.infer<typeof collectionListResponseSchema>;
export type CollectionSnapshot = z.infer<typeof collectionSnapshotSchema>;
export type CollectionListQuery = NonNullable<operations['listCollections']['parameters']['query']>;

// Compile-time structural alignment checks against generated OpenAPI schemas.
const _collectionShareCheck: components['schemas']['CollectionShareDto'] | undefined = undefined as
  CollectionShare | undefined;
const _collectionCheck: components['schemas']['CollectionDto'] | undefined = undefined as
  Collection | undefined;
const _collectionListCheck: components['schemas']['CollectionListDto'] | undefined = undefined as
  CollectionListResponse | undefined;
const _collectionSnapshotCheck: components['schemas']['CollectionSnapshotDto'] | undefined =
  undefined as CollectionSnapshot | undefined;
void _collectionShareCheck;
void _collectionCheck;
void _collectionListCheck;
void _collectionSnapshotCheck;
