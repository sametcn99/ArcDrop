import { z } from 'zod';
import type { components, operations } from '../types';

export const notificationPayloadSchema = z.object({
  bookmarkId: z.string(),
  title: z.string().nullable(),
  url: z.string(),
  reminderAt: z.string(),
});

export const notificationSchema = z.object({
  id: z.string(),
  type: z.literal('reminder'),
  bookmarkId: z.string().nullable(),
  payload: notificationPayloadSchema,
  createdAt: z.string(),
  readAt: z.string().nullable(),
});

export const notificationListResponseSchema = z.object({
  items: z.array(notificationSchema),
  totalCount: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

export const markNotificationsReadRequestSchema = z.object({
  ids: z.array(z.string()).optional(),
  all: z.boolean().optional(),
});

export const markNotificationsReadResponseSchema = z.object({
  updated: z.number().int().nonnegative(),
});

export type NotificationPayload = z.infer<typeof notificationPayloadSchema>;
export type Notification = z.infer<typeof notificationSchema>;
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;
export type MarkNotificationsReadRequest = z.infer<typeof markNotificationsReadRequestSchema>;
export type MarkNotificationsReadResponse = z.infer<typeof markNotificationsReadResponseSchema>;

export type NotificationListQuery = NonNullable<
  operations['listNotifications']['parameters']['query']
>;

// Compile-time structural alignment checks against generated OpenAPI schemas.
const _payloadCheck: components['schemas']['NotificationPayloadDto'] | undefined = undefined as
  NotificationPayload | undefined;
const _notificationCheck: components['schemas']['NotificationDto'] | undefined = undefined as
  Notification | undefined;
const _listCheck: components['schemas']['NotificationListDto'] | undefined = undefined as
  NotificationListResponse | undefined;
const _markReadReqCheck: components['schemas']['MarkNotificationsReadDto'] | undefined =
  undefined as MarkNotificationsReadRequest | undefined;
const _markReadResCheck: components['schemas']['MarkNotificationsReadResponseDto'] | undefined =
  undefined as MarkNotificationsReadResponse | undefined;
void _payloadCheck;
void _notificationCheck;
void _listCheck;
void _markReadReqCheck;
void _markReadResCheck;
