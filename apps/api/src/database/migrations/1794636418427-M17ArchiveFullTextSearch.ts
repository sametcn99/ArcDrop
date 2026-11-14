/**
 * M17 — Archive & full-text search (plan D19, parity G16):
 * - Adds `bookmark_cache_status` enum (`pending | ready | failed | invalid-origin | skipped`)
 *   and `bookmarks.cache_status`, `cache_checked_at`, `cache_retry_count`,
 *   `cache_next_retry_at`, `cache_error`, `archive_text`.
 * - Adds STORED generated `tsvector` column `bookmarks.search_vector` using
 *   `'simple'` configuration (multilingual / Turkish-safe) weighted over
 *   `title` (A), `excerpt` (B), `note` (B), and `archive_text` (C), plus GIN index.
 * - Adds STORED generated `tsvector` column `highlights.search_vector` using
 *   `'simple'` configuration over `text` + `note`, plus GIN index.
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class M17ArchiveFullTextSearch1794636418427 implements MigrationInterface {
  name = 'M17ArchiveFullTextSearch1794636418427';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."bookmark_cache_status" AS ENUM('pending', 'ready', 'failed', 'invalid-origin', 'skipped')`,
    );
    await queryRunner.query(
      `ALTER TABLE "bookmarks" ADD "cache_status" "public"."bookmark_cache_status" NOT NULL DEFAULT 'pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "bookmarks" ADD "cache_checked_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "bookmarks" ADD "cache_retry_count" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "bookmarks" ADD "cache_next_retry_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "bookmarks" ADD "cache_error" text`);
    await queryRunner.query(`ALTER TABLE "bookmarks" ADD "archive_text" text`);
    await queryRunner.query(
      `ALTER TABLE "bookmarks" ADD "search_vector" tsvector GENERATED ALWAYS AS (setweight(to_tsvector('simple', COALESCE("title", '')), 'A') || setweight(to_tsvector('simple', COALESCE("excerpt", '')), 'B') || setweight(to_tsvector('simple', COALESCE("note", '')), 'B') || setweight(to_tsvector('simple', COALESCE("archive_text", '')), 'C')) STORED`,
    );
    await queryRunner.query(
      `CREATE INDEX "IX_bookmarks_user_cache_status" ON "bookmarks" ("user_id", "cache_status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IX_bookmarks_cache_retry" ON "bookmarks" ("cache_status", "cache_next_retry_at", "deleted_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IX_bookmarks_search_vector" ON "bookmarks" USING GIN ("search_vector")`,
    );

    await queryRunner.query(
      `ALTER TABLE "highlights" ADD "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', COALESCE("text", '') || ' ' || COALESCE("note", ''))) STORED`,
    );
    await queryRunner.query(
      `CREATE INDEX "IX_highlights_search_vector" ON "highlights" USING GIN ("search_vector")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IX_highlights_search_vector"`);
    await queryRunner.query(`ALTER TABLE "highlights" DROP COLUMN "search_vector"`);

    await queryRunner.query(`DROP INDEX "public"."IX_bookmarks_search_vector"`);
    await queryRunner.query(`DROP INDEX "public"."IX_bookmarks_cache_retry"`);
    await queryRunner.query(`DROP INDEX "public"."IX_bookmarks_user_cache_status"`);
    await queryRunner.query(`ALTER TABLE "bookmarks" DROP COLUMN "search_vector"`);
    await queryRunner.query(`ALTER TABLE "bookmarks" DROP COLUMN "archive_text"`);
    await queryRunner.query(`ALTER TABLE "bookmarks" DROP COLUMN "cache_error"`);
    await queryRunner.query(`ALTER TABLE "bookmarks" DROP COLUMN "cache_next_retry_at"`);
    await queryRunner.query(`ALTER TABLE "bookmarks" DROP COLUMN "cache_retry_count"`);
    await queryRunner.query(`ALTER TABLE "bookmarks" DROP COLUMN "cache_checked_at"`);
    await queryRunner.query(`ALTER TABLE "bookmarks" DROP COLUMN "cache_status"`);
    await queryRunner.query(`DROP TYPE "public"."bookmark_cache_status"`);
  }
}
