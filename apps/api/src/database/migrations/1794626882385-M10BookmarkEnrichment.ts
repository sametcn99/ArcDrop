/**
 * M10 — bookmark enrichment (plan M10, D6 highlights + G1 favorites + G7 content types):
 * - Creates the `highlights` table (`bookmark_id` FK ON DELETE CASCADE,
 *   `user_id` FK ON DELETE CASCADE, `text`, `note`, `color`, timestamps).
 * - Adds `bookmarks.favorite` (`boolean`, default `false`) and indexed `(user_id, favorite)`.
 * - Creates `bookmark_content_type` enum (`article|image|video|audio|document|book|link`)
 *   and adds `bookmarks.content_type` (default `'link'`), indexed `(user_id, content_type)`.
 * - Adds `'highlight'` to the `change_entity` enum so highlight mutations
 *   join the change log and flow through M5 delta sync with snapshots.
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class M10BookmarkEnrichment1794626882385 implements MigrationInterface {
  name = 'M10BookmarkEnrichment1794626882385';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "highlights" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "bookmark_id" uuid NOT NULL, "user_id" uuid NOT NULL, "text" text NOT NULL, "note" text, "color" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_d1c0c3c4b7c722041ea0c626411" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IX_highlights_user" ON "highlights" ("user_id")`);
    await queryRunner.query(
      `CREATE INDEX "IX_highlights_bookmark_created" ON "highlights" ("bookmark_id", "created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "bookmarks" ADD "favorite" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."bookmark_content_type" AS ENUM('article', 'image', 'video', 'audio', 'document', 'book', 'link')`,
    );
    await queryRunner.query(
      `ALTER TABLE "bookmarks" ADD "content_type" "public"."bookmark_content_type" NOT NULL DEFAULT 'link'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."change_entity" ADD VALUE IF NOT EXISTS 'highlight'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IX_bookmarks_user_content_type" ON "bookmarks" ("user_id", "content_type")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IX_bookmarks_user_favorite" ON "bookmarks" ("user_id", "favorite")`,
    );
    await queryRunner.query(
      `ALTER TABLE "highlights" ADD CONSTRAINT "FK_89b8a333585049959a1c89b4a99" FOREIGN KEY ("bookmark_id") REFERENCES "bookmarks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "highlights" ADD CONSTRAINT "FK_ef5faa0b9245db024880d12bfae" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "highlights" DROP CONSTRAINT "FK_ef5faa0b9245db024880d12bfae"`,
    );
    await queryRunner.query(
      `ALTER TABLE "highlights" DROP CONSTRAINT "FK_89b8a333585049959a1c89b4a99"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IX_bookmarks_user_favorite"`);
    await queryRunner.query(`DROP INDEX "public"."IX_bookmarks_user_content_type"`);
    await queryRunner.query(`DELETE FROM "change_events" WHERE "entity" = 'highlight'`);
    await queryRunner.query(
      `CREATE TYPE "public"."change_entity_old" AS ENUM('bookmark', 'tag', 'collection')`,
    );
    await queryRunner.query(
      `ALTER TABLE "change_events" ALTER COLUMN "entity" TYPE "public"."change_entity_old" USING "entity"::"text"::"public"."change_entity_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."change_entity"`);
    await queryRunner.query(`ALTER TYPE "public"."change_entity_old" RENAME TO "change_entity"`);
    await queryRunner.query(`ALTER TABLE "bookmarks" DROP COLUMN "content_type"`);
    await queryRunner.query(`DROP TYPE "public"."bookmark_content_type"`);
    await queryRunner.query(`ALTER TABLE "bookmarks" DROP COLUMN "favorite"`);
    await queryRunner.query(`DROP INDEX "public"."IX_highlights_bookmark_created"`);
    await queryRunner.query(`DROP INDEX "public"."IX_highlights_user"`);
    await queryRunner.query(`DROP TABLE "highlights"`);
  }
}
