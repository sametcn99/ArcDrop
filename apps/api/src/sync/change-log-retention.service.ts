import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ChangeEvent } from '@api/database/entities/change-event.entity';
import { SettingsService } from '@api/settings/settings.service';
import { LessThan, type Repository } from 'typeorm';

export interface RetentionSummary {
  purged: number;
}

const MS_PER_DAY = 86_400_000;

/**
 * Change-log retention (plan D4: "log retention capped ~90d"): deletes
 * `change_events` rows older than the instance's `changeLogRetentionDays`
 * setting (default 90, D16). Runs daily via `ChangeLogRetentionJob`; also
 * callable directly (tests, future admin tooling).
 *
 * What retention deliberately does NOT do:
 * - it does NOT touch `users.sync_seq` — cursors stay valid absolute seqs;
 * - it does NOT delete entity rows — tombstone state lives on entities
 *   (`deletedAt`) and hard-deleted entities were already recorded as
 *   `delete` events before their rows went;
 * - it does NOT record change events — compaction is log bookkeeping, not
 *   a data mutation.
 *
 * Clients whose cursor predates the retained window can no longer receive
 * a complete delta; `/sync/changes` answers `resyncRequired: true` for
 * them (see `needsResync`) and they refetch via the list endpoints. A
 * cursor inside or after the window keeps working unchanged.
 */
@Injectable()
export class ChangeLogRetentionService {
  constructor(
    @InjectRepository(ChangeEvent) private readonly events: Repository<ChangeEvent>,
    private readonly settings: SettingsService,
  ) {}

  async purgeExpired(now: Date = new Date()): Promise<RetentionSummary> {
    const retentionDays = await this.settings.get('changeLogRetentionDays');
    const cutoff = new Date(now.getTime() - retentionDays * MS_PER_DAY);

    const result = await this.events.delete({ createdAt: LessThan(cutoff) });
    return { purged: result.affected ?? 0 };
  }
}
