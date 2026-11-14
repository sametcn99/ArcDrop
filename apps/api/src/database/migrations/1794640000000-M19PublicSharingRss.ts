import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M19 — Public sharing & RSS (plan D19):
 * - Adds `collections.share_enabled` (boolean NOT NULL DEFAULT false) and
 *   `collections.share_token` (text, nullable; cleared on disable so re-enable
 *   rotates the token).
 * - Adds `IX_collections_user_share` on `(user_id, share_enabled)` for
 *   `GET /collections?shared=true|false`.
 * - Adds partial unique index `UX_collections_share_token` on `(share_token)`
 *   `WHERE "share_token" IS NOT NULL` for unauthenticated token lookup.
 */
export class M19PublicSharingRss1794640000000 implements MigrationInterface {
  name = 'M19PublicSharingRss1794640000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "collections" ADD "share_enabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`ALTER TABLE "collections" ADD "share_token" text`);
    await queryRunner.query(
      `CREATE INDEX "IX_collections_user_share" ON "collections" ("user_id", "share_enabled")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_collections_share_token" ON "collections" ("share_token") WHERE "share_token" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UX_collections_share_token"`);
    await queryRunner.query(`DROP INDEX "public"."IX_collections_user_share"`);
    await queryRunner.query(`ALTER TABLE "collections" DROP COLUMN "share_token"`);
    await queryRunner.query(`ALTER TABLE "collections" DROP COLUMN "share_enabled"`);
  }
}
