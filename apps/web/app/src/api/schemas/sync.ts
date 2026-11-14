import { z } from 'zod';
import type { components } from '../types';
import { bookmarkSchema } from './bookmarks';
import { collectionSnapshotSchema } from './collections';

export const syncActionSchema = z.enum(['create', 'update', 'delete']);
export const syncEntitySchema = z.enum(['bookmark', 'tag', 'collection', 'highlight']);

export const tagSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const highlightSnapshotSchema = z.object({
  id: z.string(),
  bookmarkId: z.string(),
  text: z.string(),
  note: z.string().nullable(),
  color: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const syncSnapshotSchema = z.union([
  bookmarkSchema,
  tagSnapshotSchema,
  collectionSnapshotSchema,
  highlightSnapshotSchema,
]);

export const syncChangeSchema = z.object({
  seq: z.string(),
  entity: syncEntitySchema,
  id: z.string(),
  action: syncActionSchema,
  snapshot: syncSnapshotSchema.nullable(),
});

export const syncChangesResponseSchema = z.object({
  resyncRequired: z.boolean(),
  changes: z.array(syncChangeSchema),
  cursor: z.string(),
});

export const syncStateSchema = z.object({
  seq: z.string(),
});

export const syncTicketSchema = z.object({
  ticket: z.string().min(1),
  expiresAt: z.string(),
});

export const syncWsChangeNotificationSchema = z.object({
  seq: z.string(),
  entity: syncEntitySchema,
  id: z.string(),
  action: syncActionSchema,
});

export const syncWsReminderNotificationSchema = z.object({
  type: z.literal('reminder'),
  bookmarkId: z.string(),
  title: z.string().nullable(),
});

export const syncWsFrameSchema = z.union([
  syncWsChangeNotificationSchema,
  syncWsReminderNotificationSchema,
]);

export type SyncAction = z.infer<typeof syncActionSchema>;
export type SyncEntity = z.infer<typeof syncEntitySchema>;
export type TagSnapshot = z.infer<typeof tagSnapshotSchema>;
export type HighlightSnapshot = z.infer<typeof highlightSnapshotSchema>;
export type SyncChange = z.infer<typeof syncChangeSchema>;
export type SyncChangesResponse = z.infer<typeof syncChangesResponseSchema>;
export type SyncState = z.infer<typeof syncStateSchema>;
export type SyncTicket = z.infer<typeof syncTicketSchema>;
export type SyncWsChangeNotification = z.infer<typeof syncWsChangeNotificationSchema>;
export type SyncWsReminderNotification = z.infer<typeof syncWsReminderNotificationSchema>;
export type SyncWsFrame = z.infer<typeof syncWsFrameSchema>;

// Compile-time structural alignment checks against generated OpenAPI schemas.
const _tagSnapshotCheck: components['schemas']['TagSnapshotDto'] | undefined = undefined as
  TagSnapshot | undefined;
const _highlightSnapshotCheck: components['schemas']['HighlightSnapshotDto'] | undefined =
  undefined as HighlightSnapshot | undefined;
const _syncChangeCheck: components['schemas']['SyncChangeDto'] | undefined = undefined as
  SyncChange | undefined;
const _syncChangesCheck: components['schemas']['SyncChangesDto'] | undefined = undefined as
  SyncChangesResponse | undefined;
const _syncStateCheck: components['schemas']['SyncStateDto'] | undefined = undefined as
  SyncState | undefined;
const _syncTicketCheck: components['schemas']['SyncTicketDto'] | undefined = undefined as
  SyncTicket | undefined;
void _tagSnapshotCheck;
void _highlightSnapshotCheck;
void _syncChangeCheck;
void _syncChangesCheck;
void _syncStateCheck;
void _syncTicketCheck;
