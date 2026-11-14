import { Inject, Injectable } from '@nestjs/common';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { APP_CONFIG } from '@api/config/app-config.service';
import type { AppConfig } from '@api/config/env.schema';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StoredArchive {
  html: string;
  text: string;
}

/**
 * On-disk permanent-copy archive storage (plan M17 / D19, parity G16).
 *
 * Files live under `ARCDROP__DATA_DIR/archives/{bookmarkId}/`:
 * - `content.html`: sanitized readable HTML extracted from the saved page/PDF
 * - `content.txt`: full extracted plain text (untruncated copy; Postgres stores
 *   a capped FTS copy in `bookmarks.archive_text`)
 *
 * All paths validate `bookmarkId` as a UUID and check `resolve()` containment
 * inside `archivesDir`. Purges, hard-deletes, account resets/deletions, and
 * URL updates remove the bookmark's archive directory.
 */
@Injectable()
export class ArchiveStorageService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get archivesDir(): string {
    return join(this.config.dataDir, 'archives');
  }

  async write(
    bookmarkId: string,
    content: StoredArchive,
  ): Promise<{ htmlBytes: number; textBytes: number }> {
    const dir = this.dirOf(bookmarkId);
    await mkdir(dir, { recursive: true });
    const htmlBuf = Buffer.from(content.html, 'utf8');
    const textBuf = Buffer.from(content.text, 'utf8');
    await Promise.all([
      writeFile(join(dir, 'content.html'), htmlBuf),
      writeFile(join(dir, 'content.txt'), textBuf),
    ]);
    return { htmlBytes: htmlBuf.byteLength, textBytes: textBuf.byteLength };
  }

  async read(bookmarkId: string): Promise<StoredArchive | null> {
    if (!UUID_PATTERN.test(bookmarkId)) return null;
    const dir = this.dirOf(bookmarkId);
    try {
      const [html, text] = await Promise.all([
        readFile(join(dir, 'content.html'), 'utf8'),
        readFile(join(dir, 'content.txt'), 'utf8'),
      ]);
      return { html, text };
    } catch {
      return null;
    }
  }

  async remove(bookmarkId: string): Promise<void> {
    if (!UUID_PATTERN.test(bookmarkId)) return;
    await rm(this.dirOf(bookmarkId), { recursive: true, force: true });
  }

  async removeMany(bookmarkIds: readonly string[]): Promise<void> {
    for (const id of bookmarkIds) {
      await this.remove(id);
    }
  }

  private dirOf(bookmarkId: string): string {
    if (!UUID_PATTERN.test(bookmarkId)) {
      throw new Error(`archive storage refuses invalid bookmark id: ${bookmarkId}`);
    }
    const base = resolve(this.archivesDir);
    const target = resolve(base, bookmarkId);
    if (!target.startsWith(base + sep)) {
      throw new Error('archive storage path escaped the archives directory');
    }
    return target;
  }
}
