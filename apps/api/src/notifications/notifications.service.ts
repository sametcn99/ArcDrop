import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { NotificationOutbox } from '@api/database/entities/notification-outbox.entity';
import { In, IsNull, type Repository } from 'typeorm';
import {
  NOTIFICATION_DEFAULT_PAGE_SIZE,
  NOTIFICATION_MAX_PAGE_SIZE,
  type ListNotificationsQueryDto,
  type MarkNotificationsReadDto,
  type MarkNotificationsReadResponseDto,
  type NotificationDto,
  type NotificationListDto,
} from './notifications.dto';

/**
 * Notifications inbox surface (plan M14 / D20). Reads from and updates
 * `notification_outbox` strictly scoped to the owning user so offline devices
 * catch up on reminders delivered while disconnected.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(NotificationOutbox)
    private readonly outbox: Repository<NotificationOutbox>,
  ) {}

  async list(userId: string, query: ListNotificationsQueryDto): Promise<NotificationListDto> {
    const page = query.page ?? 1;
    const pageSize = Math.min(
      query.pageSize ?? NOTIFICATION_DEFAULT_PAGE_SIZE,
      NOTIFICATION_MAX_PAGE_SIZE,
    );

    const qb = this.outbox.createQueryBuilder('n').where('n.userId = :userId', { userId });

    if (query.unread === true) {
      qb.andWhere('n.readAt IS NULL');
    } else if (query.unread === false) {
      qb.andWhere('n.readAt IS NOT NULL');
    }

    const totalCount = await qb.getCount();

    qb.orderBy('n.createdAt', 'DESC')
      .addOrderBy('n.id', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const rows = await qb.getMany();
    return {
      items: rows.map(toNotificationDto),
      totalCount,
      page,
      pageSize,
    };
  }

  async markRead(
    userId: string,
    dto: MarkNotificationsReadDto,
  ): Promise<MarkNotificationsReadResponseDto> {
    const hasIds = dto.ids !== undefined;
    const wantAll = dto.all === true;

    if (hasIds && dto.all !== undefined) {
      throw new BadRequestException('Provide either "ids" or "all", not both');
    }
    if (!hasIds && !wantAll) {
      throw new BadRequestException('Provide either "ids" or "all: true"');
    }

    const now = new Date();
    if (wantAll) {
      const result = await this.outbox.update({ userId, readAt: IsNull() }, { readAt: now });
      return { updated: result.affected ?? 0 };
    }

    const uniqueIds = [...new Set(dto.ids!)];
    const result = await this.outbox.update(
      { userId, id: In(uniqueIds), readAt: IsNull() },
      { readAt: now },
    );
    return { updated: result.affected ?? 0 };
  }
}

function toNotificationDto(row: NotificationOutbox): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    bookmarkId: row.bookmarkId ?? null,
    payload: row.payload,
    createdAt: row.createdAt,
    readAt: row.readAt ?? null,
  };
}
