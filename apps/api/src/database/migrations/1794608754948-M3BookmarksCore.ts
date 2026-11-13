/**
 * M3 — bookmarks core (plan D4/D5/D12/D13/D17): bookmarks (+ derived URL
 * parts, soft-delete), tags (per-user case-insensitive unique), memberships,
 * change_events and the per-user sync_seq counter.
 *
 * NOTE for M4: bookmark_collections.collection_id deliberately has NO foreign
 * key yet (the collections table arrives in M4) — M4's migration must add it
 * with ON DELETE CASCADE.
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class M3BookmarksCore1794608754948 implements MigrationInterface {
  name = 'M3BookmarksCore1794608754948';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "bookmarks" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "url" text NOT NULL, "title" text, "excerpt" text, "note" text, "cover_ref" text, "icon_ref" text, "scheme" text NOT NULL, "host" text NOT NULL, "domain" text, "port" text, "path" text NOT NULL, "query" text, "fragment" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_7f976ef6cecd37a53bd11685f32" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IX_bookmarks_user_host" ON "bookmarks"  ("user_id", "host") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IX_bookmarks_user_domain" ON "bookmarks"  ("user_id", "domain") `,
    );
    await queryRunner.query(
      `CREATE TABLE "bookmark_collections" ("bookmark_id" uuid NOT NULL, "collection_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_42e162d6485cda6090d8449464e" PRIMARY KEY ("bookmark_id", "collection_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IX_bookmark_collections_collection" ON "bookmark_collections"  ("collection_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "tags" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "name" text NOT NULL, "name_lower" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_e7dc17249a1148a1970748eda99" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_tags_user_name_lower" ON "tags"  ("user_id", "name_lower") `,
    );
    await queryRunner.query(
      `CREATE TABLE "bookmark_tags" ("bookmark_id" uuid NOT NULL, "tag_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2d558ecda3abcfa41b8152f689a" PRIMARY KEY ("bookmark_id", "tag_id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IX_bookmark_tags_tag" ON "bookmark_tags"  ("tag_id") `);
    await queryRunner.query(`CREATE TYPE "public"."change_entity" AS ENUM('bookmark', 'tag')`);
    await queryRunner.query(
      `CREATE TYPE "public"."change_action" AS ENUM('create', 'update', 'delete')`,
    );
    await queryRunner.query(
      `CREATE TABLE "change_events" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "seq" bigint NOT NULL, "entity" "public"."change_entity" NOT NULL, "entity_id" uuid NOT NULL, "action" "public"."change_action" NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b879f7f031c15bf2821d94ccd63" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IX_change_events_user_created" ON "change_events"  ("user_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_change_events_user_seq" ON "change_events"  ("user_id", "seq") `,
    );
    await queryRunner.query(`ALTER TABLE "users" ADD "sync_seq" bigint NOT NULL DEFAULT '0'`);
    await queryRunner.query(
      `ALTER TABLE "bookmark_collections" ADD CONSTRAINT "FK_a4102c96729238ec453e2022a0f" FOREIGN KEY ("bookmark_id") REFERENCES "bookmarks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "bookmark_tags" ADD CONSTRAINT "FK_fab2760408a0e460cacc6cbdacc" FOREIGN KEY ("bookmark_id") REFERENCES "bookmarks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "bookmark_tags" ADD CONSTRAINT "FK_6dbf982610ba36aeb391e1fead5" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "change_events" ADD CONSTRAINT "FK_ded01be0187a3f5a687550b5456" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "change_events" DROP CONSTRAINT "FK_ded01be0187a3f5a687550b5456"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bookmark_tags" DROP CONSTRAINT "FK_6dbf982610ba36aeb391e1fead5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bookmark_tags" DROP CONSTRAINT "FK_fab2760408a0e460cacc6cbdacc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bookmark_collections" DROP CONSTRAINT "FK_a4102c96729238ec453e2022a0f"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "sync_seq"`);
    await queryRunner.query(`DROP INDEX "public"."UX_change_events_user_seq"`);
    await queryRunner.query(`DROP INDEX "public"."IX_change_events_user_created"`);
    await queryRunner.query(`DROP TABLE "change_events"`);
    await queryRunner.query(`DROP TYPE "public"."change_action"`);
    await queryRunner.query(`DROP TYPE "public"."change_entity"`);
    await queryRunner.query(`DROP INDEX "public"."IX_bookmark_tags_tag"`);
    await queryRunner.query(`DROP TABLE "bookmark_tags"`);
    await queryRunner.query(`DROP INDEX "public"."UX_tags_user_name_lower"`);
    await queryRunner.query(`DROP TABLE "tags"`);
    await queryRunner.query(`DROP INDEX "public"."IX_bookmark_collections_collection"`);
    await queryRunner.query(`DROP TABLE "bookmark_collections"`);
    await queryRunner.query(`DROP INDEX "public"."IX_bookmarks_user_domain"`);
    await queryRunner.query(`DROP INDEX "public"."IX_bookmarks_user_host"`);
    await queryRunner.query(`DROP TABLE "bookmarks"`);
  }
}
