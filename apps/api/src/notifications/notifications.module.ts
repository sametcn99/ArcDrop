import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChangeLogModule } from '@api/change-log/change-log.module';
import { Bookmark } from '@api/database/entities/bookmark.entity';
import { NotificationOutbox } from '@api/database/entities/notification-outbox.entity';
import { SyncModule } from '@api/sync/sync.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { RemindersJob } from './reminders.job';
import { RemindersService } from './reminders.service';

/**
 * Reminders & notifications (plan M14 / D20): per-minute due-reminder sweep
 * writing durable `NotificationOutbox` rows and pushing live websocket frames
 * (no SMTP), plus the `GET /notifications` & `POST /notifications/read` inbox.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Bookmark, NotificationOutbox]), ChangeLogModule, SyncModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, RemindersService, RemindersJob],
  exports: [NotificationsService, RemindersService],
})
export class NotificationsModule {}
