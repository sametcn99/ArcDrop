import { MigrationInterface, QueryRunner } from 'typeorm';

export class M14RemindersNotifications1794632472998 implements MigrationInterface {
  name = 'M14RemindersNotifications1794632472998';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."notification_type" AS ENUM('reminder')`);
    await queryRunner.query(
      `CREATE TABLE "notification_outbox" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "type" "public"."notification_type" NOT NULL DEFAULT 'reminder', "bookmark_id" uuid, "payload" jsonb NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "read_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_83d47c7dba1da2d038749fe757e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IX_notification_outbox_user_read_created" ON "notification_outbox"  ("user_id", "read_at", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IX_notification_outbox_user_created" ON "notification_outbox"  ("user_id", "created_at") `,
    );
    await queryRunner.query(`ALTER TABLE "bookmarks" ADD "reminder_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "bookmarks" ADD "reminded_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(
      `CREATE INDEX "IX_bookmarks_reminder_due" ON "bookmarks"  ("reminder_at", "reminded_at", "deleted_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IX_bookmarks_user_reminder_at" ON "bookmarks"  ("user_id", "reminder_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "notification_outbox" ADD CONSTRAINT "FK_6cebf6f9720f5d90acb2d9054b1" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification_outbox" ADD CONSTRAINT "FK_51a34eb1fe7185c877039bd1846" FOREIGN KEY ("bookmark_id") REFERENCES "bookmarks"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notification_outbox" DROP CONSTRAINT "FK_51a34eb1fe7185c877039bd1846"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification_outbox" DROP CONSTRAINT "FK_6cebf6f9720f5d90acb2d9054b1"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IX_bookmarks_user_reminder_at"`);
    await queryRunner.query(`DROP INDEX "public"."IX_bookmarks_reminder_due"`);
    await queryRunner.query(`ALTER TABLE "bookmarks" DROP COLUMN "reminded_at"`);
    await queryRunner.query(`ALTER TABLE "bookmarks" DROP COLUMN "reminder_at"`);
    await queryRunner.query(`DROP INDEX "public"."IX_notification_outbox_user_created"`);
    await queryRunner.query(`DROP INDEX "public"."IX_notification_outbox_user_read_created"`);
    await queryRunner.query(`DROP TABLE "notification_outbox"`);
    await queryRunner.query(`DROP TYPE "public"."notification_type"`);
  }
}
