import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import type { Repository } from 'typeorm';
import { IsNull } from 'typeorm';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@api/bookmarks/bookmarks.dto';
import { BookmarksService } from '@api/bookmarks/bookmarks.service';
import { compareSiblings, type CollectionTreeRow } from '@api/collections/tree-builder';
import { Bookmark } from '@api/database/entities/bookmark.entity';
import { Collection } from '@api/database/entities/collection.entity';
import { queryRows } from '@api/database/query-rows';
import type {
  PublicBookmarkDto,
  PublicCollectionNodeDto,
  PublicCollectionPageDto,
  PublicCollectionQueryDto,
} from './public-sharing.dto';
import { buildRssFeed } from './rss-builder';

export const RSS_ITEM_LIMIT = 50;
const MAX_TREE_WALK = 10_000;

export type PublicBookmarkProjectionRow = Pick<
  Bookmark,
  'storageKind' | 'url' | 'title' | 'excerpt' | 'coverRef' | 'iconRef' | 'contentType' | 'createdAt'
>;

/**
 * Strictly maps a bookmark row + tag names into `PublicBookmarkDto` containing
 * ONLY the 8 M19 allowlisted keys (`title`, `url`, `excerpt`, `coverRef`,
 * `iconRef`, `tags`, `contentType`, `createdAt`). File-backed items expose
 * metadata only with `url: null` (no file bytes or private `fileRef`).
 */
export function toPublicBookmarkDto(
  row: PublicBookmarkProjectionRow,
  tags: readonly string[],
): PublicBookmarkDto {
  const isFile = row.storageKind === 'file';
  return {
    title: row.title ?? null,
    url: isFile ? null : (row.url ?? null),
    excerpt: row.excerpt ?? null,
    coverRef: isFile ? null : (row.coverRef ?? null),
    iconRef: isFile ? null : (row.iconRef ?? null),
    tags: [...tags],
    contentType: row.contentType ?? 'link',
    createdAt: row.createdAt,
  };
}

interface SharedSubtreeContext {
  root: Collection;
  collectionTree: PublicCollectionNodeDto;
  collectionPath: string;
  subtreeIds: string[];
  subtreeIdSet: Set<string>;
}

/**
 * Unauthenticated read model for publicly shared collections and their RSS 2.0
 * feeds (plan M19 / D19). Every unknown, malformed, disabled, or trashed token
 * fails with the exact same 404 (`Shared collection not found`) so existence
 * is never leaked.
 */
@Injectable()
export class PublicSharingService {
  constructor(
    @InjectRepository(Collection) private readonly collections: Repository<Collection>,
    @InjectRepository(Bookmark) private readonly bookmarks: Repository<Bookmark>,
    private readonly bookmarksService: BookmarksService,
  ) {}

  async getCollection(
    shareToken: string,
    query: PublicCollectionQueryDto,
  ): Promise<PublicCollectionPageDto> {
    const ctx = await this.resolveSharedSubtree(shareToken);

    let targetCollectionIds = ctx.subtreeIds;
    if (query.collectionId !== undefined) {
      if (!ctx.subtreeIdSet.has(query.collectionId)) {
        throw new NotFoundException('Shared collection not found');
      }
      targetCollectionIds = [query.collectionId];
    }

    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

    const qb = this.bookmarks
      .createQueryBuilder('b')
      .select([
        'b.id',
        'b.storageKind',
        'b.url',
        'b.title',
        'b.excerpt',
        'b.coverRef',
        'b.iconRef',
        'b.contentType',
        'b.createdAt',
      ])
      .where('b.userId = :userId', { userId: ctx.root.userId })
      .andWhere('b.deletedAt IS NULL')
      .andWhere(
        `EXISTS (
          SELECT 1 FROM bookmark_collections bc
           WHERE bc.bookmark_id = b.id AND bc.collection_id = ANY(:collectionIds::uuid[])
        )`,
        { collectionIds: targetCollectionIds },
      );

    const totalCount = await qb.getCount();
    const rows = await qb
      .orderBy('b.createdAt', 'DESC')
      .addOrderBy('b.id', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    const tagViews = await this.bookmarksService.tagsForBookmarks(rows.map((r) => r.id));

    return {
      collection: ctx.collectionTree,
      collectionPath: ctx.collectionPath,
      items: rows.map((row) =>
        toPublicBookmarkDto(
          row,
          (tagViews.get(row.id) ?? []).map((t) => t.name),
        ),
      ),
      totalCount,
      page,
      pageSize,
    };
  }

  async getRss(shareToken: string, baseUrl: string): Promise<string> {
    const ctx = await this.resolveSharedSubtree(shareToken);

    const rows = await this.bookmarks
      .createQueryBuilder('b')
      .select([
        'b.id',
        'b.storageKind',
        'b.url',
        'b.title',
        'b.excerpt',
        'b.coverRef',
        'b.iconRef',
        'b.contentType',
        'b.createdAt',
      ])
      .where('b.userId = :userId', { userId: ctx.root.userId })
      .andWhere('b.deletedAt IS NULL')
      .andWhere(
        `EXISTS (
          SELECT 1 FROM bookmark_collections bc
           WHERE bc.bookmark_id = b.id AND bc.collection_id = ANY(:collectionIds::uuid[])
        )`,
        { collectionIds: ctx.subtreeIds },
      )
      .orderBy('b.createdAt', 'DESC')
      .addOrderBy('b.id', 'ASC')
      .take(RSS_ITEM_LIMIT)
      .getMany();

    const tagViews = await this.bookmarksService.tagsForBookmarks(rows.map((r) => r.id));
    const encodedToken = encodeURIComponent(shareToken);
    const link = `${baseUrl}/api/v1/public/collections/${encodedToken}`;
    const selfUrl = `${link}/rss`;

    return buildRssFeed({
      title: ctx.collectionPath,
      link,
      selfUrl,
      description: `Public bookmark feed for ${ctx.collectionPath}`,
      items: rows.map((row) => {
        const publicItem = toPublicBookmarkDto(
          row,
          (tagViews.get(row.id) ?? []).map((t) => t.name),
        );
        return {
          guid: derivePublicItemGuid(shareToken, row.id),
          title: publicItem.title,
          url: publicItem.url,
          excerpt: publicItem.excerpt,
          tags: publicItem.tags,
          createdAt: publicItem.createdAt,
        };
      }),
    });
  }

  // -- internals -------------------------------------------------------------

  private async resolveSharedSubtree(shareToken: string): Promise<SharedSubtreeContext> {
    const root = await this.collections.findOne({
      where: { shareToken, shareEnabled: true, deletedAt: IsNull() },
    });
    if (!root) {
      throw new NotFoundException('Shared collection not found');
    }

    const activeRows = await this.collections.find({
      where: { userId: root.userId, deletedAt: IsNull() },
      select: {
        id: true,
        parentId: true,
        title: true,
        icon: true,
        color: true,
        order: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const byId = new Map<string, Collection>(activeRows.map((row) => [row.id, row]));
    if (!byId.has(root.id)) {
      throw new NotFoundException('Shared collection not found');
    }

    const childrenByParent = new Map<string, Collection[]>();
    for (const row of activeRows) {
      if (row.parentId === null) continue;
      const list = childrenByParent.get(row.parentId) ?? [];
      list.push(row);
      childrenByParent.set(row.parentId, list);
    }

    // BFS across active descendants starting at `root.id` (trashed children
    // and anything beneath them are absent from `activeRows`).
    const visited = new Set<string>([root.id]);
    const frontier: string[] = [root.id];
    while (frontier.length > 0 && visited.size < MAX_TREE_WALK) {
      const currentId = frontier.shift()!;
      const children = childrenByParent.get(currentId) ?? [];
      for (const child of children) {
        if (visited.has(child.id)) continue;
        visited.add(child.id);
        frontier.push(child.id);
        if (visited.size >= MAX_TREE_WALK) break;
      }
    }
    const subtreeIds = [...visited];

    const countRows = await queryRows(
      this.collections.manager,
      `SELECT bc.collection_id AS id, COUNT(*) AS count
         FROM bookmark_collections bc
         JOIN bookmarks b ON b.id = bc.bookmark_id
        WHERE bc.collection_id = ANY($1::uuid[])
          AND b.user_id = $2::uuid
          AND b.deleted_at IS NULL
        GROUP BY bc.collection_id`,
      [subtreeIds, root.userId],
    );
    const counts = new Map<string, number>();
    for (const row of countRows) {
      counts.set(String(row.id), Number(row.count));
    }

    const buildNode = (row: Collection, isRoot: boolean): PublicCollectionNodeDto => {
      const directChildren = (childrenByParent.get(row.id) ?? [])
        .filter((child) => visited.has(child.id))
        .sort((a, b) => compareSiblings(toTreeCompareRow(a), toTreeCompareRow(b)));

      return {
        id: row.id,
        parentId: isRoot ? null : (row.parentId ?? null),
        title: row.title,
        icon: row.icon ?? null,
        color: row.color ?? null,
        order: row.order,
        bookmarkCount: counts.get(row.id) ?? 0,
        children: directChildren.map((child) => buildNode(child, false)),
      };
    };

    const collectionPath = buildActiveCollectionPath(root.id, byId);

    return {
      root,
      collectionTree: buildNode(root, true),
      collectionPath,
      subtreeIds,
      subtreeIdSet: visited,
    };
  }
}

function toTreeCompareRow(row: Collection): CollectionTreeRow {
  return {
    id: row.id,
    parentId: row.parentId ?? null,
    title: row.title,
    icon: row.icon ?? null,
    color: row.color ?? null,
    order: row.order,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function buildActiveCollectionPath(rootId: string, byId: ReadonlyMap<string, Collection>): string {
  const segments: string[] = [];
  const seen = new Set<string>();
  let currentId: string | null = rootId;
  let steps = 0;
  while (currentId !== null && steps < MAX_TREE_WALK) {
    if (seen.has(currentId)) break;
    const node = byId.get(currentId);
    if (!node) break;
    seen.add(currentId);
    segments.unshift(node.title);
    currentId = node.parentId ?? null;
    steps++;
  }
  return segments.join(' / ');
}

function derivePublicItemGuid(shareToken: string, bookmarkId: string): string {
  const digest = createHash('sha256')
    .update(`${shareToken}:${bookmarkId}`)
    .digest('hex')
    .slice(0, 32);
  return `urn:arcdrop:item:${digest}`;
}
