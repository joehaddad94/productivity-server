import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TaskStatusesController } from './task-statuses.controller';
import { TaskStatusesService } from './task-statuses.service';

@Module({
  imports: [AuthModule],
  controllers: [TaskStatusesController],
  providers: [TaskStatusesService],
  exports: [TaskStatusesService],
})
export class TaskStatusesModule {}
