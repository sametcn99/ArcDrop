import { describe, expect, it } from 'bun:test';
import { PayloadTooLargeException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { UploadQuotaService } from './upload-quota.service';

describe('UploadQuotaService (M18)', () => {
  const service = new UploadQuotaService();

  it('computes UTC YYYY-MM month buckets and exact next-month rollover timestamps', () => {
    expect(service.currentMonthBucket(new Date('2026-11-14T23:59:59.000Z'))).toEqual({
      month: '2026-11',
      resetAt: '2026-12-01T00:00:00.000Z',
    });
    expect(service.currentMonthBucket(new Date('2026-12-31T23:59:59.999Z'))).toEqual({
      month: '2026-12',
      resetAt: '2027-01-01T00:00:00.000Z',
    });
  });

  it('throws 413 UPLOAD_QUOTA_EXCEEDED with limitBytes, usedBytes, and resetAt when quota would be exceeded', async () => {
    const fakeManager = {
      findOneBy: async () => ({ key: 'monthlyUploadQuotaBytes', value: 1000 }),
      query: async (sql: string) => {
        if (sql.includes('SELECT bytes_used')) {
          return [{ bytesUsed: '850' }];
        }
        return [];
      },
    } as unknown as EntityManager;

    let caught: unknown;
    try {
      await service.consumeOrThrow(
        fakeManager,
        'user-1',
        200,
        new Date('2026-11-14T10:00:00.000Z'),
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(PayloadTooLargeException);
    const response = (caught as PayloadTooLargeException).getResponse() as Record<string, unknown>;
    expect(response['code']).toBe('UPLOAD_QUOTA_EXCEEDED');
    expect(response['limitBytes']).toBe(1000);
    expect(response['usedBytes']).toBe(850);
    expect(response['resetAt']).toBe('2026-12-01T00:00:00.000Z');
  });

  it('increments monthly usage when within the quota ceiling', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const fakeManager = {
      findOneBy: async () => ({ key: 'monthlyUploadQuotaBytes', value: 1000 }),
      query: async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        if (sql.includes('SELECT bytes_used')) {
          return [{ bytesUsed: '600' }];
        }
        return [];
      },
    } as unknown as EntityManager;

    const result = await service.consumeOrThrow(
      fakeManager,
      'user-1',
      400,
      new Date('2026-11-14T10:00:00.000Z'),
    );

    expect(result).toEqual({
      month: '2026-11',
      usedBytes: 1000,
      limitBytes: 1000,
      resetAt: '2026-12-01T00:00:00.000Z',
    });
    expect(queries.some((q) => q.sql.includes('UPDATE upload_usage') && q.params[2] === 1000)).toBe(
      true,
    );
  });
});
