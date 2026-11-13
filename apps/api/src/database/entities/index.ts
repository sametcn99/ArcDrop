import type { EntitySchema } from 'typeorm';

/**
 * TypeORM entities registered on the DataSource.
 *
 * Convention (do not break): keep this an EXPLICIT list of classes — no
 * filesystem globs. Globs break under `bun build` bundling and under the
 * bundled production image. The first domain entity arrives with M2 (users).
 */
type EntityCtor = new (...args: never[]) => object;

export const entities: Array<EntityCtor | EntitySchema> = [];
