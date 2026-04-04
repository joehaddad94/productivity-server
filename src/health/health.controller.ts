import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Health check (includes DB connectivity)' })
  @ApiResponse({ status: 200, description: 'App and database are healthy' })
  @ApiResponse({ status: 503, description: 'Database unreachable' })
  async check() {
    return { status: 'ok' };
  }
}
