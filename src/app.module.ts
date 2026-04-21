import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { MailModule } from './mail/mail.module';
import { NotesModule } from './notes/notes.module';
import { TagsModule } from './tags/tags.module';
import { TasksModule } from './tasks/tasks.module';
import { ProjectsModule } from './projects/projects.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { NotificationsModule } from './notifications/notifications.module';
import { CalendarConnectionsModule } from './calendar-connections/calendar-connections.module';
import { BugReportsModule } from './bug-reports/bug-reports.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    PrismaModule,
    MailModule,
    HealthModule,
    UsersModule,
    AuthModule,
    WorkspacesModule,
    NotesModule,
    TagsModule,
    TasksModule,
    ProjectsModule,
    AnalyticsModule,
    NotificationsModule,
    CalendarConnectionsModule,
    BugReportsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
