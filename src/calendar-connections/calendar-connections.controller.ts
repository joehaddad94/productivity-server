import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
  Redirect,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CalendarConnectionsService } from './calendar-connections.service';

@ApiTags('calendar-connections')
@Controller('calendar-connections')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CalendarConnectionsController {
  constructor(
    private readonly service: CalendarConnectionsService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List connected calendars' })
  async list(@CurrentUser() user: RequestUser) {
    return this.service.listConnections(user.id);
  }

  @Get('google/auth')
  @ApiOperation({ summary: 'Redirect to Google OAuth consent screen' })
  @Redirect()
  googleAuth() {
    const url = this.service.getGoogleAuthUrl();
    return { url };
  }

  @Get('google/callback')
  @ApiOperation({ summary: 'Google OAuth callback' })
  @Redirect()
  async googleCallback(
    @CurrentUser() user: RequestUser,
    @Query('code') code: string,
  ) {
    await this.service.handleGoogleCallback(user.id, code);
    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    return { url: `${frontendUrl}/settings?calendar=connected&provider=google` };
  }

  @Get('microsoft/auth')
  @ApiOperation({ summary: 'Redirect to Microsoft OAuth consent screen' })
  @Redirect()
  microsoftAuth() {
    const url = this.service.getMicrosoftAuthUrl();
    return { url };
  }

  @Get('microsoft/callback')
  @ApiOperation({ summary: 'Microsoft OAuth callback' })
  @Redirect()
  async microsoftCallback(
    @CurrentUser() user: RequestUser,
    @Query('code') code: string,
  ) {
    await this.service.handleMicrosoftCallback(user.id, code);
    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    return { url: `${frontendUrl}/settings?calendar=connected&provider=microsoft` };
  }

  @Delete(':provider')
  @ApiOperation({ summary: 'Disconnect a calendar provider' })
  async disconnect(
    @CurrentUser() user: RequestUser,
    @Param('provider') provider: string,
  ) {
    await this.service.disconnect(user.id, provider);
    return { ok: true };
  }

  @Get('events')
  @ApiOperation({ summary: 'Fetch events from all connected calendars' })
  async events(
    @CurrentUser() user: RequestUser,
    @Query('start') start: string,
    @Query('end') end: string,
  ) {
    return this.service.getEvents(user.id, start, end);
  }
}
