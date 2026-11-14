import { describe, expect, it } from 'bun:test';
import type { ChangeLogService, ChangeRecorder } from '@api/change-log/change-log.service';
import type { SyncGateway } from '@api/sync/sync.gateway';
import type { EntityManager } from 'typeorm';
import { RemindersJob } from './reminders.job';
import { RemindersService } from './reminders.service';

describe('RemindersService', () => {
  it('returns fired=0 and never calls pushToUser when no reminders are due', async () => {
    const pushed: Array<{ userId: string; frame: Record<string, unknown> }> = [];
    const manager = {
      query: async () => [],
    } as unknown as EntityManager;

    const changeLog = {
      transact: async <T>(work: (m: EntityManager, record: ChangeRecorder) => Promise<T>) =>
        work(manager, async () => '1'),
    } as unknown as ChangeLogService;

    const gateway = {
      pushToUser: (userId: string, frame: Record<string, unknown>) => {
        pushed.push({ userId, frame });
      },
    } as unknown as SyncGateway;

    const service = new RemindersService(changeLog, gateway);
    const summary = await service.processDueReminders(new Date('2026-11-14T10:00:00.000Z'));

    expect(summary).toEqual({ fired: 0 });
    expect(pushed).toEqual([]);
  });

  it('writes outbox row, sets remindedAt, records bookmark:update, and pushes post-commit', async () => {
    const events: string[] = [];
    const pushed: Array<{ userId: string; frame: Record<string, unknown> }> = [];
    const insertedOutbox: unknown[] = [];
    const updatedBookmarks: unknown[] = [];

    const dueRow = {
      id: '00000000-0000-4000-8000-000000000010',
      user_id: '00000000-0000-4000-8000-000000000001',
      title: 'Read me',
      url: 'https://example.com/read',
      reminder_at: new Date('2026-11-14T09:59:00.000Z'),
    };

    const manager = {
      query: async () => [dueRow],
      create: (_entity: unknown, obj: unknown) => obj,
      update: async (_entity: unknown, criteria: unknown, patch: unknown) => {
        events.push('update-bookmark');
        updatedBookmarks.push({ criteria, patch });
        return { affected: 1 };
      },
      insert: async (_entity: unknown, entries: unknown) => {
        events.push('insert-outbox');
        insertedOutbox.push(entries);
      },
    } as unknown as EntityManager;

    const changeLog = {
      transact: async <T>(work: (m: EntityManager, record: ChangeRecorder) => Promise<T>) => {
        const res = await work(manager, async (userId, input) => {
          events.push(`record:${userId}:${input.entity}:${input.action}`);
          return '1';
        });
        events.push('commit');
        return res;
      },
    } as unknown as ChangeLogService;

    const gateway = {
      pushToUser: (userId: string, frame: Record<string, unknown>) => {
        events.push('push');
        pushed.push({ userId, frame });
      },
    } as unknown as SyncGateway;

    const service = new RemindersService(changeLog, gateway);
    const now = new Date('2026-11-14T10:00:00.000Z');
    const summary = await service.processDueReminders(now);

    expect(summary).toEqual({ fired: 1 });
    expect(updatedBookmarks).toHaveLength(1);
    expect(insertedOutbox).toHaveLength(1);
    expect(pushed).toEqual([
      {
        userId: '00000000-0000-4000-8000-000000000001',
        frame: {
          type: 'reminder',
          bookmarkId: '00000000-0000-4000-8000-000000000010',
          title: 'Read me',
        },
      },
    ]);
    // Push MUST happen strictly after transaction commit
    expect(events.indexOf('commit')).toBeLessThan(events.indexOf('push'));
  });

  it('never calls pushToUser if transaction rolls back', async () => {
    const pushed: unknown[] = [];
    const changeLog = {
      transact: async () => {
        throw new Error('db conflict');
      },
    } as unknown as ChangeLogService;
    const gateway = {
      pushToUser: (userId: string, frame: Record<string, unknown>) => {
        pushed.push({ userId, frame });
      },
    } as unknown as SyncGateway;

    const service = new RemindersService(changeLog, gateway);
    await expect(service.processDueReminders()).rejects.toThrow('db conflict');
    expect(pushed).toEqual([]);
  });
});

describe('RemindersJob', () => {
  it('skips overlapping cron invocations while a sweep is still running', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const reminders = {
      processDueReminders: async () => {
        calls += 1;
        await gate;
        return { fired: 0 };
      },
    } as unknown as RemindersService;

    const job = new RemindersJob(reminders);
    const first = job.handle();
    const overlapping = job.handle();
    expect(calls).toBe(1);
    release();
    await Promise.all([first, overlapping]);

    // Next tick runs normally once the prior run completed.
    await job.handle();
    expect(calls).toBe(2);
  });
});
