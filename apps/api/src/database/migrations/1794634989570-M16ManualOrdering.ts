/**
 * M16 — manual ordering (plan D19 / D21): adds nullable `bookmark_collections.order`
 * with `DEFAULT 0` so pre-existing memberships occupy slot 0 and newly appended
 * memberships (`MAX(order) + 1`) follow after them, while still allowing `NULL`
 * rows to sort `NULLS LAST` under `sort=manual`.
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class M16ManualOrdering1794634989570 implements MigrationInterface {
  name = 'M16ManualOrdering1794634989570';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bookmark_collections" ADD "order" integer DEFAULT '0'`);
    await queryRunner.query(
      `CREATE INDEX "IX_bookmark_collections_collection_order" ON "bookmark_collections" ("collection_id", "order")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IX_bookmark_collections_collection_order"`);
    await queryRunner.query(`ALTER TABLE "bookmark_collections" DROP COLUMN "order"`);
  }
}
