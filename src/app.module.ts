import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SentryModule } from '@sentry/nestjs/setup';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
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
import { TimerStateModule } from './timer-state/timer-state.module';
import { SseModule } from './sse/sse.module';
import { MeModule } from './me/me.module';

@Module({
  imports: [
    SentryModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
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
    TimerStateModule,
    SseModule,
    MeModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
