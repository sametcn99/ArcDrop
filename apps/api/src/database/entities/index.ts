import type { EntitySchema } from 'typeorm';
import { Bookmark } from './bookmark.entity';
import { BookmarkCollection } from './bookmark-collection.entity';
import { BookmarkTag } from './bookmark-tag.entity';
import { AuditLogEntry } from './audit-log-entry.entity';
import { ChangeEvent } from './change-event.entity';
import { Collection } from './collection.entity';
import { OneTimeToken } from './one-time-token.entity';
import { PersonalAccessToken } from './personal-access-token.entity';
import { RefreshToken } from './refresh-token.entity';
import { Setting } from './setting.entity';
import { Tag } from './tag.entity';
import { User } from './user.entity';

/**
 * TypeORM entities registered on the DataSource.
 *
 * Convention (do not break): keep this an EXPLICIT list of classes — no
 * filesystem globs. Globs break under `bun build` bundling and under the
 * bundled production image.
 */
type EntityCtor = new (...args: never[]) => object;

export const entities: Array<EntityCtor | EntitySchema> = [
  User,
  RefreshToken,
  OneTimeToken,
  PersonalAccessToken,
  Setting,
  AuditLogEntry,
  Bookmark,
  Tag,
  BookmarkTag,
  BookmarkCollection,
  Collection,
  ChangeEvent,
];
