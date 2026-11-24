import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PortableFileIdentity1794641000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE bookmarks ADD COLUMN portable_source_id uuid');
    await queryRunner.query(
      'CREATE UNIQUE INDEX "UQ_bookmarks_user_portable_source" ON bookmarks (user_id, portable_source_id) WHERE portable_source_id IS NOT NULL',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "UQ_bookmarks_user_portable_source"');
    await queryRunner.query('ALTER TABLE bookmarks DROP COLUMN portable_source_id');
  }
}
