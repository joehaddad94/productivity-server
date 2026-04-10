import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationsService } from './notifications.service';
import { NotificationsController, NotificationsMeController } from './notifications.controller';
import { NotificationsScheduler } from './notifications.scheduler';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [NotificationsController, NotificationsMeController],
  providers: [NotificationsService, NotificationsScheduler],
  exports: [NotificationsService],
})
export class NotificationsModule {}
