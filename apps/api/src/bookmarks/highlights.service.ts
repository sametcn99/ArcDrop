import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { Repository } from 'typeorm';
import { ChangeLogService } from '@api/change-log/change-log.service';
import type { RequestUser } from '@api/auth/decorators/current-user.decorator';
import { Bookmark } from '@api/database/entities/bookmark.entity';
import { Highlight } from '@api/database/entities/highlight.entity';
import {
  HighlightDto,
  HighlightListDto,
  type CreateHighlightDto,
  type UpdateHighlightDto,
} from './bookmarks.dto';

function normalizeOptional(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Highlight CRUD (plan D6, M10). User-scoped via both `Highlight.userId` and
 * parent `Bookmark.userId`.
 *
 * - Read (`GET /bookmarks/{id}/highlights`) includes trashed bookmarks so
 *   highlights survive soft-delete and reappear on restore.
 * - Mutations (`POST /bookmarks/{id}/highlights`, `PUT/DELETE /highlights/{id}`)
 *   refuse trashed parent bookmarks (404 among active bookmarks).
 * - Every create/update/delete runs through `ChangeLogService.transact` and
 *   emits a `highlight` change event with `entityId = highlight.id`.
 */
@Injectable()
export class HighlightsService {
  constructor(
    @InjectRepository(Highlight) private readonly highlights: Repository<Highlight>,
    @InjectRepository(Bookmark) private readonly bookmarks: Repository<Bookmark>,
    private readonly changeLog: ChangeLogService,
  ) {}

  async list(user: RequestUser, bookmarkId: string): Promise<HighlightListDto> {
    const bookmark = await this.bookmarks.findOneBy({ id: bookmarkId, userId: user.id });
    if (!bookmark) throw new NotFoundException('Bookmark not found');

    const rows = await this.highlights.find({
      where: { bookmarkId, userId: user.id },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return { items: rows.map(toHighlightDto) };
  }

  async create(
    user: RequestUser,
    bookmarkId: string,
    dto: CreateHighlightDto,
  ): Promise<HighlightDto> {
    const text = dto.text.trim();
    if (text.length === 0) {
      throw new BadRequestException('text must not be empty');
    }

    return this.changeLog.transact(async (manager, record) => {
      const bookmark = await manager.findOne(Bookmark, {
        where: { id: bookmarkId, userId: user.id },
      });
      if (!bookmark) throw new NotFoundException('Bookmark not found');
      if (bookmark.deletedAt) {
        throw new NotFoundException('Bookmark not found among the active bookmarks');
      }

      const now = new Date();
      const entity = manager.create(Highlight, {
        id: randomUUID(),
        bookmarkId,
        userId: user.id,
        text,
        note: normalizeOptional(dto.note) ?? null,
        color: normalizeOptional(dto.color) ?? null,
        createdAt: now,
        updatedAt: now,
      });
      await manager.insert(Highlight, entity);
      await record(user.id, { entity: 'highlight', entityId: entity.id, action: 'create' });
      return toHighlightDto(entity);
    });
  }

  async update(user: RequestUser, id: string, dto: UpdateHighlightDto): Promise<HighlightDto> {
    let trimmedText: string | undefined;
    if (dto.text !== undefined) {
      trimmedText = dto.text.trim();
      if (trimmedText.length === 0) {
        throw new BadRequestException('text must not be empty');
      }
    }

    return this.changeLog.transact(async (manager, record) => {
      const row = await manager.findOne(Highlight, { where: { id, userId: user.id } });
      if (!row) throw new NotFoundException('Highlight not found');

      const parent = await manager.findOne(Bookmark, {
        where: { id: row.bookmarkId, userId: user.id },
      });
      if (!parent || parent.deletedAt) {
        throw new NotFoundException('Bookmark not found among the active bookmarks');
      }

      const patch: Partial<Highlight> = {};
      if (trimmedText !== undefined) patch.text = trimmedText;
      if (dto.note !== undefined) patch.note = normalizeOptional(dto.note) ?? null;
      if (dto.color !== undefined) patch.color = normalizeOptional(dto.color) ?? null;

      if (Object.keys(patch).length > 0) {
        await manager.update(Highlight, { id: row.id }, patch);
      }
      await record(user.id, { entity: 'highlight', entityId: row.id, action: 'update' });

      const fresh = await manager.findOneByOrFail(Highlight, { id: row.id });
      return toHighlightDto(fresh);
    });
  }

  async delete(user: RequestUser, id: string): Promise<void> {
    await this.changeLog.transact(async (manager, record) => {
      const row = await manager.findOne(Highlight, { where: { id, userId: user.id } });
      if (!row) throw new NotFoundException('Highlight not found');

      const parent = await manager.findOne(Bookmark, {
        where: { id: row.bookmarkId, userId: user.id },
      });
      if (!parent || parent.deletedAt) {
        throw new NotFoundException('Bookmark not found among the active bookmarks');
      }

      await manager.delete(Highlight, { id: row.id, userId: user.id });
      await record(user.id, { entity: 'highlight', entityId: row.id, action: 'delete' });
    });
  }
}

/**
 * Maps a `Highlight` row to its wire shape — exported so M5 delta sync
 * serves byte-identical `HighlightSnapshotDto` payloads.
 */
export function toHighlightDto(row: Highlight): HighlightDto {
  return {
    id: row.id,
    bookmarkId: row.bookmarkId,
    text: row.text,
    note: row.note ?? null,
    color: row.color ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
