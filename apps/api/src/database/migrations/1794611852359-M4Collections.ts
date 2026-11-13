/**
 * M4 — collections (plan M4, D5/D4): the `collections` table (hierarchical,
 * plain-`deleted_at` trash), the long-awaited FK on
 * `bookmark_collections.collection_id` (annotated in M3, ON DELETE CASCADE),
 * and the `collection` value added to the `change_entity` enum so collection
 * mutations join the change log.
 *
 * `ALTER TYPE ... ADD VALUE` runs fine inside TypeORM's migration
 * transaction on PG 12+ as long as the new value is not USED in the same
 * transaction — this migration is schema-only, no rows are written.
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class M4Collections1794611852359 implements MigrationInterface {
  name = 'M4Collections1794611852359';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "collections" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "parent_id" uuid, "title" text NOT NULL, "icon" text, "color" text, "order" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_21c00b1ebbd41ba1354242c5c4e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IX_collections_user_parent" ON "collections"  ("user_id", "parent_id") `,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."change_entity" ADD VALUE IF NOT EXISTS 'collection'`,
    );
    await queryRunner.query(
      `ALTER TABLE "collections" ADD CONSTRAINT "FK_0f812cc4eb3b50276468bb4a1a7" FOREIGN KEY ("parent_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "bookmark_collections" ADD CONSTRAINT "FK_6314fed467f5b8e49d91ac3e06c" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bookmark_collections" DROP CONSTRAINT "FK_6314fed467f5b8e49d91ac3e06c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "collections" DROP CONSTRAINT "FK_0f812cc4eb3b50276468bb4a1a7"`,
    );
    // The enum cannot drop values, so it is swapped for the M3 shape — any
    // rows recorded as 'collection' must go first or the USING cast fails.
    await queryRunner.query(`DELETE FROM "change_events" WHERE "entity" = 'collection'`);
    await queryRunner.query(`CREATE TYPE "public"."change_entity_old" AS ENUM('bookmark', 'tag')`);
    await queryRunner.query(
      `ALTER TABLE "change_events" ALTER COLUMN "entity" TYPE "public"."change_entity_old" USING "entity"::"text"::"public"."change_entity_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."change_entity"`);
    await queryRunner.query(`ALTER TYPE "public"."change_entity_old" RENAME TO "change_entity"`);
    await queryRunner.query(`DROP INDEX "public"."IX_collections_user_parent"`);
    await queryRunner.query(`DROP TABLE "collections"`);
  }
}
