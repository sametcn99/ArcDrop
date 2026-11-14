import { MigrationInterface, QueryRunner } from 'typeorm';

export class M12LibraryHealth1794629705566 implements MigrationInterface {
  name = 'M12LibraryHealth1794629705566';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bookmarks" ADD "last_checked_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "bookmarks" ADD "broken_reason" text`);
    await queryRunner.query(`ALTER TABLE "bookmarks" ADD "broken_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(
      `CREATE INDEX "IX_bookmarks_user_broken_at" ON "bookmarks"  ("user_id", "broken_at") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IX_bookmarks_user_broken_at"`);
    await queryRunner.query(`ALTER TABLE "bookmarks" DROP COLUMN "broken_at"`);
    await queryRunner.query(`ALTER TABLE "bookmarks" DROP COLUMN "broken_reason"`);
    await queryRunner.query(`ALTER TABLE "bookmarks" DROP COLUMN "last_checked_at"`);
  }
}
