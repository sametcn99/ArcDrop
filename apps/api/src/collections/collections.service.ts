import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Bookmark } from '@api/database/entities/bookmark.entity';
import { BookmarkCollection } from '@api/database/entities/bookmark-collection.entity';
import { Collection } from '@api/database/entities/collection.entity';
import { ChangeLogService } from '@api/change-log/change-log.service';
import type { EntityManager, Repository } from 'typeorm';
import { In, IsNull, Not } from 'typeorm';
import type { RequestUser } from '@api/auth/decorators/current-user.decorator';
import { queryRows } from '@api/database/query-rows';
import type {
  BookmarkCollectionsDto,
  CollectionDto,
  CollectionListDto,
  CollectionNodeDto,
  CreateCollectionDto,
  ReorderCollectionsDto,
  UpdateCollectionDto,
} from './collections.dto';
import { buildCollectionTree, type CollectionTreeRow } from './tree-builder';

/**
 * Defensive cap for parent-chain walks (cycle detection). Unreachable
 * through the API — a chain this long would need a pre-existing data cycle,
 * and any walk that long means the data is corrupt; fail loudly instead of
 * spinning.
 */
const MAX_TREE_WALK = 10_000;

/**
 * Collections domain (plan M4, D5): hierarchical folders, the nested tree
 * with direct bookmark counts, exact membership sync, cycle protection and
 * sibling ordering — all user-scoped and change-logged (plan D4).
 *
 * A row another user owns simply does not exist (404, never 403). Trash is
 * the plain-`deletedAt` discipline shared with bookmarks:
 *
 * - `DELETE` is a SOFT delete (trash) on the first call; a second `DELETE`
 *   on the same id HARD-deletes the row (a `collection:delete` tombstone).
 *   A hard delete refuses while the subtree still holds ACTIVE rows — with
 *   or without `?cascade=trash` — and never touches bookmark rows; only the
 *   membership rows die (their owners record `bookmark:update` events).
 * - List/tree show active rows only; restore puts back exactly one row.
 */
@Injectable()
export class CollectionsService {
  constructor(
    @InjectRepository(Collection) private readonly collections: Repository<Collection>,
    @InjectRepository(BookmarkCollection)
    private readonly memberships: Repository<BookmarkCollection>,
    @InjectRepository(Bookmark) private readonly bookmarks: Repository<Bookmark>,
    private readonly changeLog: ChangeLogService,
  ) {}

  // -- Reads -----------------------------------------------------------------

  /**
   * Flat rows of the caller's ACTIVE collections. Grouped per parent (roots
   * first), siblings ordered by the shared comparator: `order` asc,
   * `createdAt` asc, `id` asc.
   */
  async list(user: RequestUser): Promise<CollectionListDto> {
    const rows = await this.collections
      .createQueryBuilder('c')
      .where('c.userId = :userId', { userId: user.id })
      .andWhere('c.deletedAt IS NULL')
      .orderBy('c.parentId', 'ASC', 'NULLS FIRST')
      .addOrderBy('c.order', 'ASC')
      .addOrderBy('c.createdAt', 'ASC')
      .addOrderBy('c.id', 'ASC')
      .getMany();
    const counts = await this.bookmarkCounts(user.id);
    return { items: rows.map((row) => toCollectionDto(row, counts)) };
  }

  /**
   * Nested tree of the caller's ACTIVE collections with DIRECT bookmark
   * counts per node (a parent does not add its subtree's counts). A child
   * whose parent is trashed is promoted to the root level so restored
   * subtrees never disappear.
   */
  async tree(user: RequestUser): Promise<CollectionNodeDto[]> {
    const rows = await this.collections.find({
      where: { userId: user.id, deletedAt: IsNull() },
    });
    const counts = await this.bookmarkCounts(user.id);
    return buildCollectionTree(rows.map(toTreeRow), counts);
  }

  /** One active collection by id — trashed rows are 404 (the trash is blind). */
  async get(user: RequestUser, id: string): Promise<CollectionDto> {
    const row = await this.collections.findOneBy({ id, userId: user.id, deletedAt: IsNull() });
    if (!row) throw new NotFoundException('Collection not found');
    const counts = await this.bookmarkCounts(user.id);
    return toCollectionDto(row, counts);
  }

  // -- Mutations -------------------------------------------------------------

  /**
   * Creates a root (no `parentId`) or a child. The new row appends to the
   * end of its sibling group (`MAX(order) + 1` among ACTIVE siblings).
   */
  async create(user: RequestUser, dto: CreateCollectionDto): Promise<CollectionDto> {
    const title = normalizeTitle(dto.title);

    const row = await this.changeLog.transact(async (manager, record) => {
      let parentId: string | null = null;
      if (dto.parentId !== undefined && dto.parentId !== null) {
        const parent = await manager.findOne(Collection, {
          where: { id: dto.parentId, userId: user.id, deletedAt: IsNull() },
        });
        if (!parent) throw new NotFoundException('Parent collection not found');
        parentId = parent.id;
      }

      const id = randomUUID(); // explicit so the event can reference it
      // Record FIRST: the seq increment takes the user's row lock, which
      // serializes concurrent per-user mutations — the MAX(order) scan
      // below therefore sees sibling rows of in-flight creates once they
      // commit, and two concurrent creates can never pick the same slot.
      await record(user.id, { entity: 'collection', entityId: id, action: 'create' });
      const order = await this.nextSiblingOrder(manager, user.id, parentId);

      const entity = manager.create(Collection, {
        id,
        userId: user.id,
        parentId,
        title,
        icon: dto.icon ?? null,
        color: dto.color ?? null,
        order,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });
      await manager.insert(Collection, entity);
      return entity;
    });

    return toCollectionDto(row, new Map());
  }

  /**
   * PUT semantics: provided fields replace (`icon`/`color` accept explicit
   * `null` to clear), absent fields stay. `parentId: null` moves to the
   * root level; a move under one of the collection's own descendants is a
   * 409 (cycle protection). Refuses trashed rows (404).
   */
  async update(user: RequestUser, id: string, dto: UpdateCollectionDto): Promise<CollectionDto> {
    return this.changeLog.transact(async (manager, record) => {
      const row = await manager.findOne(Collection, { where: { id, userId: user.id } });
      if (!row) throw new NotFoundException('Collection not found');
      if (row.deletedAt) {
        throw new NotFoundException('Collection not found among the active collections');
      }

      const patch: Partial<Collection> = {};
      if (dto.title !== undefined) patch.title = normalizeTitle(dto.title);
      if (dto.icon !== undefined) patch.icon = dto.icon;
      if (dto.color !== undefined) patch.color = dto.color;

      if (dto.parentId !== undefined && dto.parentId !== row.parentId) {
        if (dto.parentId !== null) {
          const parent = await manager.findOne(Collection, {
            where: { id: dto.parentId, userId: user.id, deletedAt: IsNull() },
          });
          if (!parent) throw new NotFoundException('Parent collection not found');
          await this.assertNoCycle(manager, user.id, row.id, dto.parentId);
        }
        patch.parentId = dto.parentId;
      }

      if (Object.keys(patch).length > 0) {
        await manager.update(Collection, { id: row.id }, patch); // bumps updatedAt
      }
      await record(user.id, { entity: 'collection', entityId: row.id, action: 'update' });

      const fresh = await manager.findOneByOrFail(Collection, { id: row.id });
      const counts = await this.bookmarkCounts(user.id, manager);
      return toCollectionDto(fresh, counts);
    });
  }

  /**
   * DELETE, two-phase (see the class doc):
   *
   * - First call (active row): trashes the row. Blocked with 409 while
   *   ACTIVE child collections exist unless `?cascade=trash`, which trashes
   *   the whole ACTIVE subtree (the row included — so a cascade on a leaf
   *   trashes its direct bookmarks too) plus every ACTIVE bookmark in it.
   * - Second call (trashed row): HARD-deletes the row (tombstone
   *   `collection:delete`). Refuses while direct child rows exist (any
   *   trash state) unless `?cascade=trash`, which sweeps the trashed
   *   descendants too — but ACTIVE descendants are always refused. The
   *   bookmarks keep their rows; only their membership rows die, and each
   *   affected bookmark records a `bookmark:update` event.
   */
  async delete(user: RequestUser, id: string, cascade: boolean): Promise<void> {
    await this.changeLog.transact(async (manager, record) => {
      const row = await manager.findOne(Collection, { where: { id, userId: user.id } });
      if (!row) throw new NotFoundException('Collection not found');

      if (row.deletedAt === null) {
        // -- First call: trash -------------------------------------------
        const activeChildren = await manager.count(Collection, {
          where: { userId: user.id, parentId: id, deletedAt: IsNull() },
        });
        if (activeChildren > 0 && !cascade) {
          throw new ConflictException(
            'The collection still has child collections — pass ?cascade=trash to trash the whole subtree',
          );
        }

        const now = new Date();
        // The cascade target is the WHOLE active subtree — the root
        // included — so a cascade on a leaf trashes its direct bookmarks
        // too ("trash everything under this collection" holds regardless
        // of children).
        const trashedIds =
          cascade && activeChildren > 0
            ? await this.collectSubtreeIds(manager, user.id, id, true)
            : [row.id];
        await manager.update(Collection, { id: In(trashedIds) }, { deletedAt: now });
        if (cascade) {
          // Trash every ACTIVE bookmark directly carried by the subtree.
          const trashedBookmarks = await queryRows(
            manager,
            `UPDATE bookmarks b
                SET deleted_at = $2
              WHERE b.user_id = $1
                AND b.deleted_at IS NULL
                AND EXISTS (
                  SELECT 1 FROM bookmark_collections bc
                   WHERE bc.bookmark_id = b.id AND bc.collection_id = ANY($3::uuid[])
                )
              RETURNING b.id`,
            [user.id, now, trashedIds],
          );
          for (const bookmark of trashedBookmarks) {
            await record(user.id, {
              entity: 'bookmark',
              entityId: String(bookmark.id),
              action: 'update',
            });
          }
        }
        for (const collectionId of trashedIds) {
          await record(user.id, { entity: 'collection', entityId: collectionId, action: 'update' });
        }
        return;
      }

      // -- Second call: hard delete --------------------------------------
      const childRows = await manager.count(Collection, {
        where: { userId: user.id, parentId: id },
      });
      if (childRows > 0 && !cascade) {
        throw new ConflictException(
          'The collection is trashed and still has child rows — pass ?cascade=trash to remove them too',
        );
      }

      let doomedIds: string[] = [row.id];
      if (cascade && childRows > 0) {
        doomedIds = await this.collectSubtreeIds(manager, user.id, id, false);
        const activeIds = await manager.find(Collection, {
          where: { id: In(doomedIds), deletedAt: IsNull() },
          select: { id: true },
        });
        if (activeIds.length > 0) {
          // A restored child under a trashed parent, or similar. Hard
          // delete never sweeps live material — refuse instead.
          throw new ConflictException(
            'The subtree still contains ACTIVE collections — restore or trash them first',
          );
        }
      }

      // Memberships die with the rows; each owner bookmark records an
      // update so sync clients re-pull their (now smaller) collection sets.
      const losingMemberships = await queryRows(
        manager,
        `SELECT DISTINCT bookmark_id FROM bookmark_collections
          WHERE collection_id = ANY($1::uuid[])`,
        [doomedIds],
      );
      await manager.delete(BookmarkCollection, { collectionId: In(doomedIds) });
      await manager.delete(Collection, { id: In(doomedIds) });

      for (const collectionId of doomedIds) {
        await record(user.id, { entity: 'collection', entityId: collectionId, action: 'delete' });
      }
      for (const row_ of losingMemberships) {
        await record(user.id, {
          entity: 'bookmark',
          entityId: String(row_.bookmark_id),
          action: 'update',
        });
      }
    });
  }

  /**
   * Restores exactly ONE trashed collection row. It does NOT restore
   * cascade-trashed descendants or bookmarks — those stay in the trash
   * until individually restored (or purged). Until the parent is restored
   * too, the child shows up at the tree's root level (root promotion).
   */
  async restore(user: RequestUser, id: string): Promise<CollectionDto> {
    return this.changeLog.transact(async (manager, record) => {
      const result = await manager.update(
        Collection,
        { id, userId: user.id, deletedAt: Not(IsNull()) },
        { deletedAt: null },
      );
      if ((result.affected ?? 0) === 0) throw new NotFoundException('Collection not found');
      await record(user.id, { entity: 'collection', entityId: id, action: 'update' });

      const fresh = await manager.findOneByOrFail(Collection, { id });
      const counts = await this.bookmarkCounts(user.id, manager);
      return toCollectionDto(fresh, counts);
    });
  }

  /**
   * Explicit positions for the listed collections (`PATCH /collections/
   * order`). Unspecified siblings keep their current `order`; rows whose
   * value does not change record no event. Refuses trashed rows (404).
   */
  async reorder(user: RequestUser, dto: ReorderCollectionsDto): Promise<void> {
    const ids = dto.items.map((item) => item.id);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Duplicate collection id in the order payload');
    }

    await this.changeLog.transact(async (manager, record) => {
      const rows = await manager.find(Collection, {
        where: { userId: user.id, id: In(ids) },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      for (const item of dto.items) {
        const row = byId.get(item.id);
        if (!row) throw new NotFoundException(`Collection not found: ${item.id}`);
        if (row.deletedAt) {
          throw new NotFoundException(
            `Collection not found among the active collections: ${item.id}`,
          );
        }
      }
      for (const item of dto.items) {
        const row = byId.get(item.id)!;
        if (row.order === item.order) continue;
        await manager.update(Collection, { id: row.id }, { order: item.order });
        await record(user.id, { entity: 'collection', entityId: row.id, action: 'update' });
      }
    });
  }

  /**
   * Replaces a bookmark's exact collection set (plan D5 — many-to-many):
   * memberships to listed collections are ensured, memberships to absent
   * ones are removed, and every collection whose set actually changed
   * records a `collection:update` on top of the bookmark's own
   * `bookmark:update` (the multi-event convention — M5 devices refetch).
   *
   * Refuses trashed bookmarks (the trash is read-only except for restore)
   * and unknown/inactive/foreign collections (404).
   */
  async syncBookmarkCollections(
    user: RequestUser,
    bookmarkId: string,
    collectionIds: readonly string[],
  ): Promise<BookmarkCollectionsDto> {
    return this.changeLog.transact(async (manager, record) => {
      const bookmark = await manager.findOne(Bookmark, {
        where: { id: bookmarkId, userId: user.id },
      });
      if (!bookmark) throw new NotFoundException('Bookmark not found');
      if (bookmark.deletedAt) {
        throw new NotFoundException('Bookmark not found among the active bookmarks');
      }

      // Dedupe preserving order; resolve each id to an ACTIVE row.
      const wanted: string[] = [];
      for (const cid of collectionIds) {
        if (!wanted.includes(cid)) wanted.push(cid);
      }
      for (const cid of wanted) {
        const collection = await manager.findOne(Collection, {
          where: { id: cid, userId: user.id, deletedAt: IsNull() },
        });
        if (!collection) throw new NotFoundException(`Collection not found: ${cid}`);
      }

      const current = await manager.find(BookmarkCollection, {
        where: { bookmarkId },
      });
      const wantedSet = new Set(wanted);
      const toRemove = current.map((m) => m.collectionId).filter((cid) => !wantedSet.has(cid));
      const currentSet = new Set(current.map((m) => m.collectionId));
      const toAdd = wanted.filter((cid) => !currentSet.has(cid));

      if (toRemove.length > 0) {
        await manager.delete(BookmarkCollection, { bookmarkId, collectionId: In(toRemove) });
      }
      if (toAdd.length > 0) {
        await manager.insert(
          BookmarkCollection,
          toAdd.map((cid) => ({ bookmarkId, collectionId: cid })),
        );
      }

      await record(user.id, { entity: 'bookmark', entityId: bookmarkId, action: 'update' });
      for (const cid of new Set([...toRemove, ...toAdd])) {
        await record(user.id, { entity: 'collection', entityId: cid, action: 'update' });
      }

      const membershipRows = await queryRows(
        manager,
        `SELECT c.id AS id, c.title AS title
           FROM bookmark_collections bc
           JOIN collections c ON c.id = bc.collection_id
          WHERE bc.bookmark_id = $1
          ORDER BY lower(c.title) ASC, c.id ASC`,
        [bookmarkId],
      );
      return {
        collections: membershipRows.map((m) => ({
          id: String(m.id),
          title: String(m.title),
        })),
      };
    });
  }

  // -- internals -------------------------------------------------------------

  /** Next sibling position: `MAX(order) + 1` over ACTIVE siblings, 0 if none. */
  private async nextSiblingOrder(
    manager: EntityManager,
    userId: string,
    parentId: string | null,
  ): Promise<number> {
    const rows = await queryRows(
      manager,
      `SELECT COALESCE(MAX("order"), -1) + 1 AS next
         FROM collections
        WHERE user_id = $1
          AND parent_id IS NOT DISTINCT FROM $2::uuid
          AND deleted_at IS NULL`,
      [userId, parentId],
    );
    return Number(rows[0]?.next ?? 0);
  }

  /**
   * Cycle guard for parent moves: walks UP the parent chain from the new
   * parent; if the moved collection (or any already-visited ancestor)
   * appears, the move would create a parent_id cycle → 409.
   */
  private async assertNoCycle(
    manager: EntityManager,
    userId: string,
    collectionId: string,
    newParentId: string,
  ): Promise<void> {
    const visited = new Set<string>([collectionId]);
    let current: string | null = newParentId;
    let steps = 0;
    while (current !== null && steps < MAX_TREE_WALK) {
      if (visited.has(current)) {
        throw new ConflictException(
          'Moving the collection under this parent would make it its own ancestor',
        );
      }
      visited.add(current);
      const parent: Collection | null = await manager.findOne(Collection, {
        where: { id: current, userId },
        select: { id: true, parentId: true },
      });
      if (!parent) break; // chain end (dangling ids are impossible via the FK)
      current = parent.parentId;
      steps++;
    }
    if (current !== null) {
      throw new Error(`Collection parent chain exceeded ${MAX_TREE_WALK} steps — corrupt data`);
    }
  }

  /**
   * All collection ids of the subtree rooted at `rootId` (the root
   * included). `activeOnly` filters to non-trashed rows (first-call
   * cascade); otherwise every descendant row counts (second-call sweep).
   * A visited-set guards against pathological data.
   */
  private async collectSubtreeIds(
    manager: EntityManager,
    userId: string,
    rootId: string,
    activeOnly: boolean,
  ): Promise<string[]> {
    const visited = new Set<string>([rootId]);
    let frontier: string[] = [rootId];
    while (frontier.length > 0) {
      const sql = activeOnly
        ? `SELECT id FROM collections
            WHERE user_id = $1 AND parent_id = ANY($2::uuid[]) AND deleted_at IS NULL`
        : `SELECT id FROM collections
            WHERE user_id = $1 AND parent_id = ANY($2::uuid[])`;
      const children = await queryRows(manager, sql, [userId, frontier]);
      frontier = children
        .map((row) => String(row.id))
        .filter((id) => {
          if (visited.has(id)) return false;
          visited.add(id);
          return true;
        });
    }
    return [...visited];
  }

  /**
   * Direct bookmark counts over ACTIVE bookmarks, keyed by collection id —
   * one grouped query shared by list/tree/get.
   */
  private async bookmarkCounts(
    userId: string,
    manager?: EntityManager,
  ): Promise<Map<string, number>> {
    const em = manager ?? this.memberships.manager;
    const rows = await queryRows(
      em,
      `SELECT bc.collection_id AS id, COUNT(*) AS count
         FROM bookmark_collections bc
         JOIN bookmarks b ON b.id = bc.bookmark_id
        WHERE b.user_id = $1 AND b.deleted_at IS NULL
        GROUP BY bc.collection_id`,
      [userId],
    );
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(String(row.id), Number(row.count));
    }
    return counts;
  }
}

function toTreeRow(row: Collection): CollectionTreeRow {
  return {
    id: row.id,
    parentId: row.parentId ?? null,
    title: row.title,
    icon: row.icon,
    color: row.color,
    order: row.order,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCollectionDto(row: Collection, counts: ReadonlyMap<string, number>): CollectionDto {
  return {
    id: row.id,
    parentId: row.parentId ?? null, // in-memory entities may carry undefined
    title: row.title,
    icon: row.icon,
    color: row.color,
    order: row.order,
    bookmarkCount: counts.get(row.id) ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeTitle(raw: string): string {
  const title = raw.trim();
  if (title.length === 0) {
    throw new BadRequestException('Collection title must not be empty');
  }
  return title;
}
