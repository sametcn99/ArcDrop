import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import {
  NOTIFICATION_TYPES,
  type NotificationType,
  type ReminderNotificationPayload,
} from '@api/database/entities/notification-outbox.entity';

export const NOTIFICATION_DEFAULT_PAGE_SIZE = 20;
export const NOTIFICATION_MAX_PAGE_SIZE = 200;
export const MAX_MARK_READ_IDS = 500;

/** Query-string boolean: `true/1` → true, `false/0/''` → false, else invalid. */
const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true' || value === true || value === 1 || value === '1') return true;
  if (value === 'false' || value === false || value === 0 || value === '0' || value === '') {
    return false;
  }
  return value;
};

export class ListNotificationsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by read status (`true` = unread only, `false` = read only, omitted = all)',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  unread?: boolean;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: NOTIFICATION_MAX_PAGE_SIZE,
    default: NOTIFICATION_DEFAULT_PAGE_SIZE,
    description: `Page size (above ${NOTIFICATION_MAX_PAGE_SIZE} is clamped)`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}

export class MarkNotificationsReadDto {
  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    minItems: 1,
    maxItems: MAX_MARK_READ_IDS,
    description: 'Notification IDs to mark read (mutually exclusive with `all: true`)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_MARK_READ_IDS)
  @IsUUID(undefined, { each: true })
  ids?: string[];

  @ApiPropertyOptional({
    description: 'Set to `true` to mark all unread notifications as read',
  })
  @IsOptional()
  @IsBoolean()
  all?: boolean;
}

export class NotificationPayloadDto {
  @ApiProperty({ format: 'uuid' })
  bookmarkId!: string;

  @ApiProperty({ nullable: true })
  title!: string | null;

  @ApiProperty()
  url!: string;

  @ApiProperty({
    format: 'date-time',
    description: 'Scheduled reminder timestamp in UTC (clients render local time)',
  })
  reminderAt!: string;
}

export class NotificationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: NOTIFICATION_TYPES })
  type!: NotificationType;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Bookmark id (null only if the bookmark was subsequently purged from trash)',
  })
  bookmarkId!: string | null;

  @ApiProperty({ type: NotificationPayloadDto })
  payload!: ReminderNotificationPayload;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time', nullable: true })
  readAt!: Date | null;
}

export class NotificationListDto {
  @ApiProperty({ type: [NotificationDto] })
  items!: NotificationDto[];

  @ApiProperty({ description: 'Total matching notifications BEFORE paging' })
  totalCount!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty({ description: `Effective page size (clamped to ${NOTIFICATION_MAX_PAGE_SIZE})` })
  pageSize!: number;
}

export class MarkNotificationsReadResponseDto {
  @ApiProperty({ description: 'Number of unread notifications transitioned to read' })
  updated!: number;
}
