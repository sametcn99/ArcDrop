import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, type Repository } from 'typeorm';
import { Setting } from '@api/database/entities/setting.entity';
import type { SettingsDto, UpdateSettingsDto } from './settings.dto';

/**
 * Runtime instance settings (plan D16; extended M12): DB-backed key/value rows
 * merged over these defaults, so an admin can flip the registration toggle,
 * retention knobs, or broken-link mode at runtime — no container recreate, no
 * restart. Secrets and infrastructure (JWT secret, DB URL) deliberately stay
 * env-only.
 */
const DEFAULTS: SettingsDto = {
  registrationOpen: false,
  trashRetentionDays: 30,
  changeLogRetentionDays: 90,
  brokenLinkCheckMode: 'default',
};

export type SettingsKey = keyof SettingsDto;

const KNOWN_KEYS: SettingsKey[] = [
  'registrationOpen',
  'trashRetentionDays',
  'changeLogRetentionDays',
  'brokenLinkCheckMode',
];

@Injectable()
export class SettingsService {
  constructor(@InjectRepository(Setting) private readonly settings: Repository<Setting>) {}

  /** Current settings: stored values merged over the defaults. */
  async getAll(): Promise<SettingsDto> {
    const rows = await this.settings.findBy({ key: In(KNOWN_KEYS) });
    const merged: SettingsDto = { ...DEFAULTS };
    for (const row of rows) {
      if (isSettingsKey(row.key)) {
        (merged[row.key] as unknown) = row.value;
      }
    }
    return merged;
  }

  /** Applies a validated partial patch and returns the new full state. */
  async update(patch: UpdateSettingsDto): Promise<SettingsDto> {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || !isSettingsKey(key)) continue;
      await this.settings.save({ key, value });
    }
    return this.getAll();
  }

  /** Typed read for internal consumers (e.g. the registration gate, broken links). */
  async get<K extends SettingsKey>(key: K): Promise<SettingsDto[K]> {
    const all = await this.getAll();
    return all[key];
  }
}

function isSettingsKey(key: string): key is SettingsKey {
  return (KNOWN_KEYS as string[]).includes(key);
}
