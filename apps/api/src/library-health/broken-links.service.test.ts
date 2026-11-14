import { describe, expect, it } from 'bun:test';
import type { Bookmark } from '@api/database/entities/bookmark.entity';
import type { ChangeLogService } from '@api/change-log/change-log.service';
import { MetadataFetchError, type SsrfSafeFetchService } from '@api/metadata/ssrf-fetch.service';
import type { BrokenLinkCheckMode } from '@api/settings/settings.dto';
import type { SettingsService } from '@api/settings/settings.service';
import type { EntityManager, Repository } from 'typeorm';
import { BrokenLinksService, classifyProbeOutcome } from './broken-links.service';

describe('classifyProbeOutcome (M12 detection modes)', () => {
  it('basic mode flags only 404 and 410', () => {
    expect(classifyProbeOutcome({ ok: true, status: 404 }, 'basic')).toEqual({
      kind: 'broken',
      reason: 'http-404',
    });
    expect(classifyProbeOutcome({ ok: true, status: 410 }, 'basic')).toEqual({
      kind: 'broken',
      reason: 'http-410',
    });
    expect(classifyProbeOutcome({ ok: true, status: 500 }, 'basic')).toEqual({ kind: 'ignore' });
    expect(classifyProbeOutcome({ ok: true, status: 403 }, 'basic')).toEqual({ kind: 'ignore' });
    expect(classifyProbeOutcome({ ok: false, reason: 'dns-resolution-failed' }, 'basic')).toEqual({
      kind: 'ignore',
    });
    expect(classifyProbeOutcome({ ok: false, reason: 'timeout' }, 'basic')).toEqual({
      kind: 'ignore',
    });
    expect(classifyProbeOutcome({ ok: true, status: 200 }, 'basic')).toEqual({ kind: 'healthy' });
  });

  it('default mode adds DNS failure on top of 404/410 while ignoring 5xx and timeouts', () => {
    expect(classifyProbeOutcome({ ok: true, status: 404 }, 'default')).toEqual({
      kind: 'broken',
      reason: 'http-404',
    });
    expect(classifyProbeOutcome({ ok: false, reason: 'dns-resolution-failed' }, 'default')).toEqual(
      {
        kind: 'broken',
        reason: 'dns-resolution-failed',
      },
    );
    expect(classifyProbeOutcome({ ok: true, status: 503 }, 'default')).toEqual({ kind: 'ignore' });
    expect(classifyProbeOutcome({ ok: false, reason: 'timeout' }, 'default')).toEqual({
      kind: 'ignore',
    });
    expect(classifyProbeOutcome({ ok: false, reason: 'too-many-redirects' }, 'default')).toEqual({
      kind: 'ignore',
    });
  });

  it('strict mode additionally flags 5xx, timeouts, redirect loops, and network errors', () => {
    expect(classifyProbeOutcome({ ok: true, status: 500 }, 'strict')).toEqual({
      kind: 'broken',
      reason: 'http-500',
    });
    expect(classifyProbeOutcome({ ok: true, status: 502 }, 'strict')).toEqual({
      kind: 'broken',
      reason: 'http-502',
    });
    expect(classifyProbeOutcome({ ok: false, reason: 'timeout' }, 'strict')).toEqual({
      kind: 'broken',
      reason: 'timeout',
    });
    expect(classifyProbeOutcome({ ok: false, reason: 'too-many-redirects' }, 'strict')).toEqual({
      kind: 'broken',
      reason: 'too-many-redirects',
    });
    expect(classifyProbeOutcome({ ok: false, reason: 'network-error' }, 'strict')).toEqual({
      kind: 'broken',
      reason: 'network-error',
    });
  });

  it('never marks SSRF/policy refusals as broken in any mode', () => {
    for (const mode of ['basic', 'default', 'strict'] as const) {
      for (const reason of [
        'private-address-blocked',
        'scheme-refused',
        'invalid-url',
        'unclassifiable-address',
      ]) {
        expect(classifyProbeOutcome({ ok: false, reason }, mode)).toEqual({
          kind: 'policy-skip',
        });
      }
    }
  });
});

describe('BrokenLinksService.sweep', () => {
  interface RowState {
    id: string;
    userId: string;
    url: string;
    brokenAt: Date | null;
    brokenReason: string | null;
    lastCheckedAt: Date | null;
    deletedAt: Date | null;
  }

  function makeHarness(
    initialRows: RowState[],
    mode: BrokenLinkCheckMode,
    probeImpl: (url: string) => Promise<{ status: number; finalUrl: string }>,
  ) {
    const rows = new Map(initialRows.map((r) => [r.id, { ...r }]));
    const recordedEvents: Array<{ userId: string; entityId: string; action: string }> = [];

    const repo = {
      createQueryBuilder: () => {
        // Supports either SELECT (batching) or UPDATE (touchLastCheckedAt).
        let isUpdate = false;
        let updateSet: Partial<Bookmark> = {};
        let updateWhereParams: Record<string, unknown> = {};
        let afterId: string | null = null;
        let takeLimit = 100;

        const qb = {
          select: () => qb,
          where: (_sql: string, params?: Record<string, unknown>) => {
            if (params) updateWhereParams = { ...updateWhereParams, ...params };
            return qb;
          },
          andWhere: (_sql: string, params?: Record<string, unknown>) => {
            if (params && typeof params['lastId'] === 'string') {
              afterId = params['lastId'];
            }
            return qb;
          },
          orderBy: () => qb,
          take: (n: number) => {
            takeLimit = n;
            return qb;
          },
          update: () => {
            isUpdate = true;
            return qb;
          },
          set: (patch: Partial<Bookmark>) => {
            updateSet = patch;
            return qb;
          },
          getMany: async () => {
            const active = [...rows.values()]
              .filter((r) => r.deletedAt === null && (afterId === null || r.id > afterId))
              .sort((a, b) => a.id.localeCompare(b.id))
              .slice(0, takeLimit);
            return active as unknown as Bookmark[];
          },
          execute: async () => {
            if (isUpdate) {
              const target = rows.get(String(updateWhereParams['id']));
              if (target && target.url === updateWhereParams['url'] && target.deletedAt === null) {
                Object.assign(target, updateSet);
              }
            }
            return { affected: 1 };
          },
        };
        return qb;
      },
    } as unknown as Repository<Bookmark>;

    const settings = {
      get: async () => mode,
    } as unknown as SettingsService;

    const fetcher = {
      probeUrl: (url: string) => probeImpl(url),
    } as unknown as SsrfSafeFetchService;

    const changeLog = {
      transact: async <T>(
        fn: (
          manager: EntityManager,
          record: (
            userId: string,
            ev: { entity: string; entityId: string; action: string },
          ) => Promise<void>,
        ) => Promise<T>,
      ): Promise<T> => {
        const manager = {
          findOne: async (_entity: unknown, opts: { where: { id: string; userId: string } }) => {
            const r = rows.get(opts.where.id);
            return r && r.userId === opts.where.userId ? r : null;
          },
          update: async (_entity: unknown, where: { id: string }, patch: Partial<Bookmark>) => {
            const r = rows.get(where.id);
            if (r) Object.assign(r, patch);
          },
        } as unknown as EntityManager;
        const record = async (
          userId: string,
          ev: { entity: string; entityId: string; action: string },
        ) => {
          recordedEvents.push({ userId, entityId: ev.entityId, action: ev.action });
        };
        return fn(manager, record);
      },
    } as unknown as ChangeLogService;

    return {
      service: new BrokenLinksService(repo, settings, fetcher, changeLog),
      rows,
      recordedEvents,
    };
  }

  it('skips everything when brokenLinkCheckMode is off', async () => {
    let probed = 0;
    const { service } = makeHarness(
      [
        {
          id: '00000000-0000-4000-8000-000000000001',
          userId: 'u1',
          url: 'https://dead.test/404',
          brokenAt: null,
          brokenReason: null,
          lastCheckedAt: null,
          deletedAt: null,
        },
      ],
      'off',
      async () => {
        probed++;
        return { status: 404, finalUrl: 'https://dead.test/404' };
      },
    );

    const summary = await service.sweep({ jitterMinMs: 0, jitterMaxMs: 0 });
    expect(summary).toEqual({ mode: 'off', checked: 0, markedBroken: 0, cleared: 0, skipped: 0 });
    expect(probed).toBe(0);
  });

  it('caps in-flight concurrency at ≤5, flags broken links, clears recovered links, and emits change events only on status transitions', async () => {
    const initial: RowState[] = Array.from({ length: 12 }, (_, idx) => ({
      id: `00000000-0000-4000-8000-0000000000${String(idx + 1).padStart(2, '0')}`,
      userId: 'u1',
      url:
        idx === 0
          ? 'https://broken.test/404'
          : idx === 1
            ? 'https://recovered.test/ok'
            : idx === 2
              ? 'http://127.0.0.1/private'
              : `https://healthy.test/${idx}`,
      brokenAt: idx === 1 ? new Date('2025-01-01T00:00:00Z') : null,
      brokenReason: idx === 1 ? 'http-404' : null,
      lastCheckedAt: null,
      deletedAt: null,
    }));

    let inFlight = 0;
    let peak = 0;
    const { service, rows, recordedEvents } = makeHarness(initial, 'default', async (url) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight--;
      if (url.includes('broken.test')) return { status: 404, finalUrl: url };
      if (url.includes('127.0.0.1')) {
        throw new MetadataFetchError('private-address-blocked', 'private');
      }
      return { status: 200, finalUrl: url };
    });

    const summary = await service.sweep({ concurrency: 10, jitterMinMs: 0, jitterMaxMs: 0 });
    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1);
    expect(summary).toEqual({
      mode: 'default',
      checked: 11,
      markedBroken: 1,
      cleared: 1,
      skipped: 1,
    });

    const b0 = rows.get(initial[0]!.id)!;
    expect(b0.brokenAt).not.toBeNull();
    expect(b0.brokenReason).toBe('http-404');

    const b1 = rows.get(initial[1]!.id)!;
    expect(b1.brokenAt).toBeNull();
    expect(b1.brokenReason).toBeNull();

    const b2 = rows.get(initial[2]!.id)!;
    expect(b2.brokenAt).toBeNull();
    expect(b2.lastCheckedAt).toBeNull();

    const b3 = rows.get(initial[3]!.id)!;
    expect(b3.lastCheckedAt).not.toBeNull();
    expect(b3.brokenAt).toBeNull();

    // Only the two status transitions (id[0] marked broken, id[1] cleared) emit change events.
    expect(recordedEvents.map((e) => e.entityId).sort()).toEqual([initial[0]!.id, initial[1]!.id]);
  });
});
