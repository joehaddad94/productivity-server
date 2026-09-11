import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TaskStatusesModule } from '../task-statuses/task-statuses.module';
import { SseModule } from '../sse/sse.module';
import { NotificationsService } from './notifications.service';
import {
  NotificationsController,
  NotificationsMeController,
} from './notifications.controller';
import { NotificationsScheduler } from './notifications.scheduler';

@Module({
  imports: [ScheduleModule.forRoot(), TaskStatusesModule, SseModule],
  controllers: [NotificationsController, NotificationsMeController],
  providers: [NotificationsService, NotificationsScheduler],
  exports: [NotificationsService],
})
export class NotificationsModule {}
