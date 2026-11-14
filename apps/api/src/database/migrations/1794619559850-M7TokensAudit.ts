import { MigrationInterface, QueryRunner } from 'typeorm';

export class M7TokensAudit1794619559850 implements MigrationInterface {
  name = 'M7TokensAudit1794619559850';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "audit_log_entries" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "pat_id" uuid, "actor_type" text NOT NULL, "action" text NOT NULL, "subject" text, "outcome" text NOT NULL, "detail" jsonb, "request_id" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_4f2fbddaca7c6531577e79177a4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_daa74cb114df40fe323fbbf305" ON "audit_log_entries"  ("user_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "personal_access_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "token_hash" text NOT NULL, "name" text NOT NULL, "read_only" boolean NOT NULL DEFAULT false, "last_used_at" TIMESTAMP WITH TIME ZONE, "revoked_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b6dc462fa11dbbb897eb8419735" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_aeabcd81e2cb4d39ed48753240" ON "personal_access_tokens"  ("token_hash") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_705e457b9b167e4779e737ca3e" ON "personal_access_tokens"  ("user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "personal_access_tokens" ADD CONSTRAINT "FK_705e457b9b167e4779e737ca3ef" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "personal_access_tokens" DROP CONSTRAINT "FK_705e457b9b167e4779e737ca3ef"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_705e457b9b167e4779e737ca3e"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_aeabcd81e2cb4d39ed48753240"`);
    await queryRunner.query(`DROP TABLE "personal_access_tokens"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_daa74cb114df40fe323fbbf305"`);
    await queryRunner.query(`DROP TABLE "audit_log_entries"`);
  }
}
