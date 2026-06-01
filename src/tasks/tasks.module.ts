import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SseModule } from '../sse/sse.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { TaskStatusesModule } from '../task-statuses/task-statuses.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { CommentsService } from './comments.service';

@Module({
  imports: [
    AuthModule,
    AnalyticsModule,
    TaskStatusesModule,
    NotificationsModule,
    SseModule,
  ],
  controllers: [TasksController],
  providers: [TasksService, CommentsService],
  exports: [TasksService, CommentsService],
})
export class TasksModule {}
