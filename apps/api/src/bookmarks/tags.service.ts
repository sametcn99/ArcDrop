import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Tag } from '@api/database/entities/tag.entity';
import { BookmarkTag } from '@api/database/entities/bookmark-tag.entity';
import { queryRows } from '@api/database/query-rows';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import { ChangeLogService, type ChangeRecorder } from '@api/change-log/change-log.service';
import { MAX_TAG_NAME_LENGTH, TagUsageDto, type TagDto } from './bookmarks.dto';

/**
 * Tag domain (plan M3): per-user, case-insensitively unique names, created
 * on demand when a bookmark's tag set references them, renamed/merged by
 * name, and pruned the moment their last membership disappears — a tag row
 * exists only while at least one membership references it.
 *
 * All mutations run through `ChangeLogService.transact` (plan D4).
 */
@Injectable()
export class TagsService {
  constructor(
    @InjectRepository(Tag) private readonly tags: Repository<Tag>,
    @InjectRepository(BookmarkTag) private readonly memberships: Repository<BookmarkTag>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly changeLog: ChangeLogService,
  ) {}

  // -- Reads -----------------------------------------------------------------

  /** The user's tags with usage counts over ACTIVE bookmarks, name-sorted. */
  async listUsage(userId: string): Promise<TagUsageDto[]> {
    const rows = await queryRows(
      this.dataSource.manager,
      `SELECT t.id AS id, t.name AS name, COUNT(b.id) AS count
         FROM tags t
         LEFT JOIN bookmark_tags bt ON bt.tag_id = t.id
         LEFT JOIN bookmarks b ON b.id = bt.bookmark_id AND b.deleted_at IS NULL
        WHERE t.user_id = $1
        GROUP BY t.id, t.name, t.name_lower
        ORDER BY t.name_lower ASC`,
      [userId],
    );
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      count: Number(row.count),
    }));
  }

  // -- Mutations -------------------------------------------------------------

  /**
   * Renames a tag, or — when another tag already owns the new name
   * (case-insensitive) — MERGES into it: memberships are re-pointed (rows
   * whose bookmark already carries the target are dropped), the source tag
   * dies, and every affected bookmark records an update so sync clients
   * re-pull their tag sets (plan D4).
   */
  async renameOrMerge(userId: string, currentName: string, dtoName: string): Promise<TagDto> {
    const newName = this.normalizeName(dtoName, 'name');
    const currentLower = this.normalizeName(currentName, 'name').toLowerCase();

    return this.changeLog.transact(async (manager, record) => {
      const source = await manager.findOne(Tag, { where: { userId, nameLower: currentLower } });
      if (!source) {
        throw new NotFoundException(`Tag "${currentName}" not found`);
      }

      const newLower = newName.toLowerCase();
      if (newLower === source.nameLower) {
        // Same tag: a case-only display rename (or a no-op).
        if (source.name !== newName) {
          source.name = newName;
          await manager.save(source);
          await record(userId, { entity: 'tag', entityId: source.id, action: 'update' });
        }
        return { id: source.id, name: source.name };
      }

      const target = await manager.findOne(Tag, { where: { userId, nameLower: newLower } });
      if (!target) {
        // Plain rename.
        source.name = newName;
        source.nameLower = newLower;
        await manager.save(source);
        await record(userId, { entity: 'tag', entityId: source.id, action: 'update' });
        return { id: source.id, name: source.name };
      }

      // MERGE source → target: re-point memberships, dropping rows whose
      // bookmark already carries the target (composite-PK collisions).
      const repointed = await queryRows(
        manager,
        `UPDATE bookmark_tags
            SET tag_id = $2
          WHERE tag_id = $1
            AND NOT EXISTS (
              SELECT 1 FROM bookmark_tags x
               WHERE x.tag_id = $2 AND x.bookmark_id = bookmark_tags.bookmark_id
            )
          RETURNING bookmark_id`,
        [source.id, target.id],
      );
      await manager.delete(BookmarkTag, { tagId: source.id });
      await manager.delete(Tag, { id: source.id });

      await record(userId, { entity: 'tag', entityId: source.id, action: 'delete' });
      for (const row of repointed) {
        await record(userId, {
          entity: 'bookmark',
          entityId: String(row.bookmark_id),
          action: 'update',
        });
      }
      return { id: target.id, name: target.name };
    });
  }

  /** Deletes a tag and detaches it from every bookmark (detach = delete). */
  async deleteByName(userId: string, name: string): Promise<void> {
    const nameLower = this.normalizeName(name, 'name').toLowerCase();

    await this.changeLog.transact(async (manager, record) => {
      const tag = await manager.findOne(Tag, { where: { userId, nameLower } });
      if (!tag) {
        throw new NotFoundException(`Tag "${name}" not found`);
      }

      const rows = await queryRows(
        manager,
        `DELETE FROM bookmark_tags WHERE tag_id = $1 RETURNING bookmark_id`,
        [tag.id],
      );
      await manager.delete(Tag, { id: tag.id });

      await record(userId, { entity: 'tag', entityId: tag.id, action: 'delete' });
      const affected = new Set(rows.map((row) => String(row.bookmark_id)));
      for (const bookmarkId of affected) {
        await record(userId, { entity: 'bookmark', entityId: bookmarkId, action: 'update' });
      }
    });
  }

  // -- Shared helpers (called INSIDE an existing transaction) ----------------

  /**
   * Resolves a list of raw names to the user's tags, creating missing ones
   * on demand. Trims, rejects names empty after trimming, and dedupes
   * case-insensitively (first spelling wins). Records `tag:create` events
   * for genuinely new tags.
   */
  async resolveTagNames(
    manager: EntityManager,
    userId: string,
    rawNames: readonly string[],
    record: ChangeRecorder,
  ): Promise<Tag[]> {
    // Dedupe case-insensitively, first spelling wins.
    const wanted = new Map<string, string>();
    for (const raw of rawNames) {
      const name = this.normalizeName(raw, 'tags');
      const lower = name.toLowerCase();
      if (!wanted.has(lower)) wanted.set(lower, name);
    }

    const resolved: Tag[] = [];
    for (const [lower, name] of wanted) {
      const existing = await manager.findOne(Tag, { where: { userId, nameLower: lower } });
      if (existing) {
        resolved.push(existing);
        continue;
      }
      // On-demand create. DO NOTHING + re-select keeps a concurrent creator
      // from aborting this transaction on the unique index.
      const inserted = await queryRows(
        manager,
        `INSERT INTO tags (user_id, name, name_lower)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, name_lower) DO NOTHING
         RETURNING id, name`,
        [userId, name, lower],
      );
      if (inserted.length > 0) {
        const tag = inserted[0]!;
        const tagId = String(tag.id);
        const tagName = String(tag.name);
        await record(userId, { entity: 'tag', entityId: tagId, action: 'create' });
        resolved.push({
          id: tagId,
          userId,
          name: tagName,
          nameLower: lower,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      } else {
        // Lost the create race; the winner is committed and readable.
        resolved.push(await manager.findOneByOrFail(Tag, { userId, nameLower: lower }));
      }
    }
    return resolved;
  }

  /**
   * Deletes the user's tags that have no memberships left (invariant: a tag
   * exists only while referenced), recording a `tag:delete` event per row.
   * Call AFTER membership removal, inside the same transaction.
   */
  async pruneOrphanedTags(
    manager: EntityManager,
    userId: string,
    record: ChangeRecorder,
  ): Promise<void> {
    const pruned = await queryRows(
      manager,
      `DELETE FROM tags t
        WHERE t.user_id = $1
          AND NOT EXISTS (SELECT 1 FROM bookmark_tags bt WHERE bt.tag_id = t.id)
        RETURNING id`,
      [userId],
    );
    for (const row of pruned) {
      await record(userId, { entity: 'tag', entityId: String(row.id), action: 'delete' });
    }
  }

  /** Trims and validates a tag name; empty-after-trim is a 400. */
  normalizeName(name: string, field: string): string {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new BadRequestException(`Tag ${field} must not be empty`);
    }
    if (trimmed.length > MAX_TAG_NAME_LENGTH) {
      throw new BadRequestException(
        `Tag ${field} must be at most ${MAX_TAG_NAME_LENGTH} characters`,
      );
    }
    return trimmed;
  }
}
