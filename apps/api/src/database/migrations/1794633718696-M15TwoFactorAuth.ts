import { MigrationInterface, QueryRunner } from 'typeorm';

export class M15TwoFactorAuth1794633718696 implements MigrationInterface {
  name = 'M15TwoFactorAuth1794633718696';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "tfa_recovery_codes" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "code_hash" text NOT NULL, "used_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_19bc7541c11ec1def76ac4bb84b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IX_tfa_recovery_codes_user" ON "tfa_recovery_codes" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IX_tfa_recovery_codes_user_hash" ON "tfa_recovery_codes" ("user_id", "code_hash")`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "totp_enabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`ALTER TABLE "users" ADD "totp_secret" text`);
    await queryRunner.query(
      `ALTER TYPE "public"."one_time_token_type" ADD VALUE IF NOT EXISTS 'tfa_challenge'`,
    );
    await queryRunner.query(
      `ALTER TABLE "tfa_recovery_codes" ADD CONSTRAINT "FK_40464fb1e7169e76109f866ab8a" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tfa_recovery_codes" DROP CONSTRAINT "FK_40464fb1e7169e76109f866ab8a"`,
    );
    await queryRunner.query(`DELETE FROM "one_time_tokens" WHERE "type" = 'tfa_challenge'`);
    await queryRunner.query(
      `CREATE TYPE "public"."one_time_token_type_old" AS ENUM('invite', 'reset')`,
    );
    await queryRunner.query(
      `ALTER TABLE "one_time_tokens" ALTER COLUMN "type" TYPE "public"."one_time_token_type_old" USING "type"::"text"::"public"."one_time_token_type_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."one_time_token_type"`);
    await queryRunner.query(
      `ALTER TYPE "public"."one_time_token_type_old" RENAME TO "one_time_token_type"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "totp_secret"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "totp_enabled"`);
    await queryRunner.query(`DROP INDEX "public"."IX_tfa_recovery_codes_user_hash"`);
    await queryRunner.query(`DROP INDEX "public"."IX_tfa_recovery_codes_user"`);
    await queryRunner.query(`DROP TABLE "tfa_recovery_codes"`);
  }
}
