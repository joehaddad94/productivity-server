import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ParseUUIDPipe } from '@nestjs/common/pipes';
import {
  CurrentUser,
  RequestUser,
} from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AnalyticsService } from './analytics.service';
import { QueryAnalyticsDto } from './dto/query-analytics.dto';
import { LogStatDto } from './dto/log-stat.dto';

@ApiTags('analytics')
@Controller('workspaces/:workspaceId/analytics')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get()
  @ApiOperation({ summary: 'Get analytics for a workspace' })
  @ApiResponse({ status: 200, description: 'Daily stats and totals' })
  @ApiResponse({ status: 403, description: 'Not a workspace member' })
  async getAnalytics(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser() user: RequestUser,
    @Query() query: QueryAnalyticsDto,
  ) {
    const analytics = await this.analyticsService.getAnalytics(
      workspaceId,
      user.id,
      query,
    );
    return { analytics };
  }

  @Get('team')
  @ApiOperation({ summary: 'Get per-member analytics (owner/admin only)' })
  @ApiResponse({ status: 200, description: 'Per-member totals' })
  @ApiResponse({ status: 403, description: 'Owner/admin only' })
  async getTeamAnalytics(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser() user: RequestUser,
    @Query() query: QueryAnalyticsDto,
  ) {
    const members = await this.analyticsService.getTeamAnalytics(
      workspaceId,
      user.id,
      query,
    );
    return { members };
  }

  @Post('log')
  @ApiOperation({ summary: 'Log or upsert daily stats' })
  @ApiResponse({ status: 201, description: 'Stat logged' })
  @ApiResponse({ status: 403, description: 'Not a workspace member' })
  async logStat(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: LogStatDto,
  ) {
    const stat = await this.analyticsService.logStat(workspaceId, user.id, dto);
    return { stat };
  }
}
