import { AppConfigService } from '@api/config/app-config.service';
import { loadConfig } from '@api/config/load-config';
import { createDataSource } from '@api/database/data-source';
import { TotpService } from '@api/auth/crypto/totp.service';

async function run(): Promise<void> {
  const config = loadConfig();
  if (!config.totp.encryptionKey) {
    throw new Error('Set ARCDROP__TOTP__ENCRYPTION_KEY before running this command');
  }
  const totp = new TotpService(new AppConfigService(config));
  const database = await createDataSource(config).initialize();
  try {
    const count = await database.transaction(async (manager) => {
      // One transaction keeps legacy and new keys usable as a unit on failure.
      await manager.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
      let cursor: string | null = null;
      let rotated = 0;
      while (true) {
        const rows: { id: string; totp_secret: string }[] = await manager.query(
          `SELECT id, totp_secret FROM users
           WHERE totp_secret IS NOT NULL AND ($1::uuid IS NULL OR id > $1::uuid)
           ORDER BY id LIMIT 100`,
          [cursor],
        );
        if (rows.length === 0) return rotated;
        for (const row of rows) {
          const updated = totp.reencryptSecret(row.totp_secret);
          if (updated !== null) {
            await manager.query('UPDATE users SET totp_secret = $1 WHERE id = $2', [
              updated,
              row.id,
            ]);
            rotated++;
          }
          cursor = row.id;
        }
      }
    });
    process.stdout.write(`TOTP records rotated: ${count}\n`);
  } finally {
    await database.destroy();
  }
}

void run().catch(() => {
  process.stderr.write(
    'TOTP rotation failed. Check the database and configured keys. The operation did not complete.\n',
  );
  process.exitCode = 1;
});
