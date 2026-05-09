import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TaskStatusesModule } from '../task-statuses/task-statuses.module';
import { NotificationsService } from './notifications.service';
import {
  NotificationsController,
  NotificationsMeController,
} from './notifications.controller';
import { NotificationsScheduler } from './notifications.scheduler';

@Module({
  imports: [ScheduleModule.forRoot(), TaskStatusesModule],
  controllers: [NotificationsController, NotificationsMeController],
  providers: [NotificationsService, NotificationsScheduler],
  exports: [NotificationsService],
})
export class NotificationsModule {}
