import { Module } from '@nestjs/common';
import { ChangeEventBus } from './change-event.bus';
import { ChangeLogService } from './change-log.service';

/**
 * The change-log infrastructure (plan D4). Exported so every data module
 * (bookmarks now; collections M4, sync M5) records its mutations through
 * `ChangeLogService`, and so M5's websocket gateway can subscribe to
 * `ChangeEventBus`.
 */
@Module({
  providers: [ChangeEventBus, ChangeLogService],
  exports: [ChangeEventBus, ChangeLogService],
})
export class ChangeLogModule {}
