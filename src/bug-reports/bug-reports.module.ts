import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BugReportsController } from './bug-reports.controller';
import { AdminBugReportsController } from './admin-bug-reports.controller';
import { BugReportsService } from './bug-reports.service';
import { AdminGuard } from './guards/admin.guard';

@Module({
  imports: [AuthModule],
  controllers: [BugReportsController, AdminBugReportsController],
  providers: [BugReportsService, AdminGuard],
  exports: [BugReportsService],
})
export class BugReportsModule {}
