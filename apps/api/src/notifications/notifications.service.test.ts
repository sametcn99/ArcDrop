import { describe, expect, it } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { NotificationOutbox } from '@api/database/entities/notification-outbox.entity';
import { NOTIFICATION_MAX_PAGE_SIZE } from './notifications.dto';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  it('validates markRead arguments (rejects both or neither)', async () => {
    const fakeRepo = {
      update: async () => ({ affected: 0 }),
    } as unknown as Repository<NotificationOutbox>;
    const service = new NotificationsService(fakeRepo);

    await expect(service.markRead('u1', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.markRead('u1', { all: false })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.markRead('u1', { ids: ['00000000-0000-4000-8000-000000000001'], all: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.markRead('u1', { ids: ['00000000-0000-4000-8000-000000000001'], all: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('dedupes ids and scopes markRead to unread rows of the caller', async () => {
    const calls: Array<{ criteria: unknown; patch: unknown }> = [];
    const fakeRepo = {
      update: async (criteria: unknown, patch: unknown) => {
        calls.push({ criteria, patch });
        return { affected: 1 };
      },
    } as unknown as Repository<NotificationOutbox>;
    const service = new NotificationsService(fakeRepo);

    const id = '00000000-0000-4000-8000-000000000001';
    const res = await service.markRead('u1', { ids: [id, id] });
    expect(res).toEqual({ updated: 1 });
    expect(calls).toHaveLength(1);
  });

  it('clamps pageSize to NOTIFICATION_MAX_PAGE_SIZE on list', async () => {
    let taken: number | undefined;
    const qb = {
      where: () => qb,
      andWhere: () => qb,
      getCount: async () => 0,
      orderBy: () => qb,
      addOrderBy: () => qb,
      skip: () => qb,
      take: (n: number) => {
        taken = n;
        return qb;
      },
      getMany: async () => [],
    };
    const fakeRepo = {
      createQueryBuilder: () => qb,
    } as unknown as Repository<NotificationOutbox>;
    const service = new NotificationsService(fakeRepo);

    const res = await service.list('u1', { pageSize: 9999, unread: true });
    expect(taken).toBe(NOTIFICATION_MAX_PAGE_SIZE);
    expect(res.pageSize).toBe(NOTIFICATION_MAX_PAGE_SIZE);
    expect(res.totalCount).toBe(0);
    expect(res.items).toEqual([]);
  });
});
