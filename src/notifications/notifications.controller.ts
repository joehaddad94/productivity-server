import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import { UpdateNotificationSettingsDto } from './dto/notification-settings.dto';
import { SavePushSubscriptionDto } from './dto/push-subscription.dto';

interface AuthenticatedUser { id: string; email: string }

@UseGuards(JwtAuthGuard)
@Controller('workspaces/:workspaceId/notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.service.list(
      user.id,
      workspaceId,
      skip ? parseInt(skip, 10) : 0,
      take ? parseInt(take, 10) : 50,
    );
  }

  @Get('unread-count')
  async unreadCount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
  ) {
    const count = await this.service.unreadCount(user.id, workspaceId);
    return { count };
  }

  @Patch(':id/read')
  @HttpCode(200)
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.service.markRead(user.id, id);
  }

  @Post('read-all')
  @HttpCode(200)
  markAllRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
  ) {
    return this.service.markAllRead(user.id, workspaceId);
  }

  @Delete(':id')
  @HttpCode(204)
  dismiss(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.service.dismiss(user.id, id);
  }

  @Delete()
  @HttpCode(204)
  dismissAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
  ) {
    return this.service.dismissAll(user.id, workspaceId);
  }
}

@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsMeController {
  constructor(private readonly service: NotificationsService) {}

  @Get('settings')
  getSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getSettings(user.id);
  }

  @Patch('settings')
  updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateNotificationSettingsDto,
  ) {
    return this.service.updateSettings(user.id, dto);
  }

  @Get('vapid-public-key')
  vapidPublicKey() {
    return { publicKey: this.service.getVapidPublicKey() };
  }

  @Post('push-subscription')
  @HttpCode(200)
  savePushSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SavePushSubscriptionDto,
  ) {
    return this.service.savePushSubscription(user.id, dto);
  }

  @Delete('push-subscription')
  @HttpCode(204)
  deletePushSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Body('endpoint') endpoint: string,
  ) {
    return this.service.deletePushSubscription(user.id, endpoint);
  }

  @Post('test')
  @HttpCode(200)
  async sendTestNotification(
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.createAndDeliver({
      userId: user.id,
      workspaceId: '',
      type: 'daily_agenda',
      title: 'Test Notification',
      body: 'Push notifications are working correctly.',
      userEmail: user.email,
      skipInApp: true,
    });
    return { ok: true };
  }
}
