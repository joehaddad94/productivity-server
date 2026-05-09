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
import {
  CurrentUser,
  RequestUser,
} from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CalendarConnectionsService,
  type CalendarEvent,
} from './calendar-connections.service';

@ApiTags('calendar-connections')
@Controller('calendar-connections')
@ApiBearerAuth()
export class CalendarConnectionsController {
  constructor(
    private readonly service: CalendarConnectionsService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List connected calendars' })
  async list(@CurrentUser() user: RequestUser) {
    return this.service.listConnections(user.id);
  }

  /** Returns the Google OAuth URL as JSON — frontend redirects the browser to it directly. */
  @Get('google/auth')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get Google OAuth URL' })
  googleAuth(@CurrentUser() user: RequestUser) {
    const url = this.service.getGoogleAuthUrl(user.id);
    return { url };
  }

  /** Google redirects here after consent — no session cookie needed, user ID is in signed state. */
  @Get('google/callback')
  @Redirect()
  @ApiOperation({ summary: 'Google OAuth callback' })
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
  ) {
    const userId = this.service.verifyOAuthState(state);
    await this.service.handleGoogleCallback(userId, code);
    const frontendUrl =
      this.config.get<string>('APP_URL') ?? 'http://localhost:3000';
    return {
      url: `${frontendUrl}/settings?calendar=connected&provider=google`,
    };
  }

  @Get('microsoft/auth')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get Microsoft OAuth URL' })
  microsoftAuth(@CurrentUser() user: RequestUser) {
    const url = this.service.getMicrosoftAuthUrl(user.id);
    return { url };
  }

  @Get('microsoft/callback')
  @Redirect()
  @ApiOperation({ summary: 'Microsoft OAuth callback' })
  async microsoftCallback(
    @Query('code') code: string,
    @Query('state') state: string,
  ) {
    const userId = this.service.verifyOAuthState(state);
    await this.service.handleMicrosoftCallback(userId, code);
    const frontendUrl =
      this.config.get<string>('APP_URL') ?? 'http://localhost:3000';
    return {
      url: `${frontendUrl}/settings?calendar=connected&provider=microsoft`,
    };
  }

  @Delete(':provider')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Disconnect a calendar provider' })
  async disconnect(
    @CurrentUser() user: RequestUser,
    @Param('provider') provider: string,
  ) {
    await this.service.disconnect(user.id, provider);
    return { ok: true };
  }

  @Get('events')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Fetch events from all connected calendars' })
  async events(
    @CurrentUser() user: RequestUser,
    @Query('start') start: string,
    @Query('end') end: string,
  ): Promise<CalendarEvent[]> {
    return this.service.getEvents(user.id, start, end);
  }
}
