import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M1 pipeline proof (no schema changes — real migrations start with M2).
 * Its job is to prove the migration pipeline end to end: the migration is
 * discovered, executed and recorded in the `migrations` table on boot.
 *
 * Naming convention for all future migrations — file:
 * `<unixMs>-<PascalName>.ts`, class: `<PascalName><unixMs>`. Prefer
 * `bun run migration:generate src/database/migrations <Name>` so TypeORM
 * timestamps are authoritative.
 */
export class InitialSetup1763000000000 implements MigrationInterface {
  async up(_queryRunner: QueryRunner): Promise<void> {
    // Intentionally empty — pipeline proof only.
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    // Intentionally empty — pipeline proof only.
  }
}
