import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M18 — File uploads (plan D19, Raindrop parity G17):
 * - Adds `bookmark_storage_kind` enum (`url | file`) and `bookmarks.storage_kind`.
 * - Makes `bookmarks.url`, `scheme`, `host`, and `path` nullable for `file` items.
 * - Adds `bookmarks.file_ref`, `file_name`, `file_mime`, and `file_size`, plus
 *   `IX_bookmarks_user_storage_kind`.
 * - Adds `upload_usage` table for monthly per-user upload byte counters with
 *   `ON DELETE CASCADE` to `users(id)`.
 */
export class M18FileUploads1794638000000 implements MigrationInterface {
  name = 'M18FileUploads1794638000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."bookmark_storage_kind" AS ENUM('url', 'file')`);
    await queryRunner.query(
      `ALTER TABLE "bookmarks" ADD "storage_kind" "public"."bookmark_storage_kind" NOT NULL DEFAULT 'url'`,
    );
    await queryRunner.query(`ALTER TABLE "bookmarks" ADD "file_ref" text`);
    await queryRunner.query(`ALTER TABLE "bookmarks" ADD "file_name" text`);
    await queryRunner.query(`ALTER TABLE "bookmarks" ADD "file_mime" text`);
    await queryRunner.query(`ALTER TABLE "bookmarks" ADD "file_size" bigint`);

    await queryRunner.query(`ALTER TABLE "bookmarks" ALTER COLUMN "url" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "bookmarks" ALTER COLUMN "scheme" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "bookmarks" ALTER COLUMN "host" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "bookmarks" ALTER COLUMN "path" DROP NOT NULL`);

    await queryRunner.query(
      `CREATE INDEX "IX_bookmarks_user_storage_kind" ON "bookmarks" ("user_id", "storage_kind")`,
    );

    await queryRunner.query(
      `CREATE TABLE "upload_usage" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "month" character varying(7) NOT NULL, "bytes_used" bigint NOT NULL DEFAULT 0, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_upload_usage_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_upload_usage_user_month" ON "upload_usage" ("user_id", "month")`,
    );
    await queryRunner.query(
      `ALTER TABLE "upload_usage" ADD CONSTRAINT "FK_upload_usage_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "upload_usage" DROP CONSTRAINT "FK_upload_usage_user"`);
    await queryRunner.query(`DROP INDEX "public"."UX_upload_usage_user_month"`);
    await queryRunner.query(`DROP TABLE "upload_usage"`);

    await queryRunner.query(`DROP INDEX "public"."IX_bookmarks_user_storage_kind"`);
    await queryRunner.query(`DELETE FROM "bookmarks" WHERE "storage_kind" = 'file'`);

    await queryRunner.query(`ALTER TABLE "bookmarks" ALTER COLUMN "path" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "bookmarks" ALTER COLUMN "host" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "bookmarks" ALTER COLUMN "scheme" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "bookmarks" ALTER COLUMN "url" SET NOT NULL`);

    await queryRunner.query(`ALTER TABLE "bookmarks" DROP COLUMN "file_size"`);
    await queryRunner.query(`ALTER TABLE "bookmarks" DROP COLUMN "file_mime"`);
    await queryRunner.query(`ALTER TABLE "bookmarks" DROP COLUMN "file_name"`);
    await queryRunner.query(`ALTER TABLE "bookmarks" DROP COLUMN "file_ref"`);
    await queryRunner.query(`ALTER TABLE "bookmarks" DROP COLUMN "storage_kind"`);
    await queryRunner.query(`DROP TYPE "public"."bookmark_storage_kind"`);
  }
}
