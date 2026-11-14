import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Bookmark } from '@api/database/entities/bookmark.entity';
import type { Repository } from 'typeorm';
import { FileStorageService } from './file-storage.service';

export interface FileEvictionSummary {
  evicted: number;
}

/**
 * Orphaned uploaded-file eviction (plan M18 / D19): removes file blobs under
 * `ARCDROP__DATA_DIR/files` that no bookmark row references anymore (after
 * trash purge, bulk hard-delete, account wipe, or rolled-back upload writes).
 * Note: trashed bookmarks keep their file blobs so restore continues to serve
 * them; only hard-deleted rows release their refs for eviction.
 */
@Injectable()
export class FileEvictionService {
  constructor(
    @InjectRepository(Bookmark) private readonly bookmarks: Repository<Bookmark>,
    private readonly files: FileStorageService,
  ) {}

  async evictOrphaned(): Promise<FileEvictionSummary> {
    const rows = await this.bookmarks
      .createQueryBuilder('b')
      .select(['b.fileRef AS "fileRef"'])
      .where('b.fileRef IS NOT NULL')
      .getRawMany();

    const referenced = new Set<string>();
    for (const row of rows) {
      if (typeof row.fileRef === 'string') referenced.add(row.fileRef);
    }

    return { evicted: await this.files.evictExcept(referenced) };
  }
}
