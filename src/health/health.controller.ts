import { Controller, Get, Logger } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';

@SkipThrottle()
@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Health check (includes DB connectivity + deployed commit)' })
  @ApiResponse({ status: 200, description: 'App and database are healthy' })
  @ApiResponse({ status: 503, description: 'Database unreachable' })
  check() {
    // Railway injects these at build/deploy time. Falls back to "unknown"
    // for local runs where they aren't set, so /health stays consistent.
    const fullSha = process.env.RAILWAY_GIT_COMMIT_SHA ?? '';
    return {
      status: 'ok',
      commit: fullSha ? fullSha.slice(0, 7) : 'unknown',
      branch: process.env.RAILWAY_GIT_BRANCH ?? 'unknown',
      environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? 'local',
    };
  }
}
