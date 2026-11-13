import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * A runtime instance setting (plan D16: DB runtime settings + env secrets —
 * `jwt.secret`, `database.url` and friends stay env-only, everything an admin
 * may flip at runtime lives here as key/value rows).
 *
 * `value` is jsonb so booleans and numbers round-trip without string
 * coercion; the typed surface is `SettingsService`.
 */
@Entity({ name: 'settings' })
export class Setting {
  @PrimaryColumn({ type: 'text' })
  key!: string;

  @Column({ type: 'jsonb' })
  value!: unknown;
}
