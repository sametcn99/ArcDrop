import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Bookmark } from '@api/database/entities/bookmark.entity';
import type { Repository } from 'typeorm';
import { IconCacheService } from './icon-cache.service';

export interface EvictionSummary {
  evicted: number;
}

/**
 * Icon eviction (ticket M6): removes icon FILES that no bookmark row
 * references anymore. Orphans appear when a trash purge hard-deletes
 * bookmarks, when a `refresh` run replaces a bookmark's refs, or when a
 * pipeline run wrote files but rolled back. Runs daily via
 * `IconEvictionJob`; also callable directly (tests, future tooling) and
 * fire-and-forget after every trash purge.
 */
@Injectable()
export class IconEvictionService {
  constructor(
    @InjectRepository(Bookmark) private readonly bookmarks: Repository<Bookmark>,
    private readonly icons: IconCacheService,
  ) {}

  /**
   * One sweep: gather every referenced ref across ALL bookmarks (trash
   * state is irrelevant — a trashed bookmark may still be restored, so its
   * files stay), then delete unreferenced well-formed files.
   */
  async evictOrphaned(): Promise<EvictionSummary> {
    const rows = await this.bookmarks
      .createQueryBuilder('b')
      .select(['b.coverRef AS "coverRef"', 'b.iconRef AS "iconRef"'])
      .where('b.coverRef IS NOT NULL OR b.iconRef IS NOT NULL')
      .getRawMany();

    const referenced = new Set<string>();
    for (const row of rows) {
      if (typeof row.coverRef === 'string') referenced.add(row.coverRef);
      if (typeof row.iconRef === 'string') referenced.add(row.iconRef);
    }

    return { evicted: await this.icons.evictExcept(referenced) };
  }
}
