import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from './guards/admin.guard';
import { BugReportsService } from './bug-reports.service';
import { QueryAdminBugReportsDto } from './dto/query-admin-bug-reports.dto';
import { UpdateBugReportDto } from './dto/update-bug-report.dto';

@ApiTags('admin-bug-reports')
@Controller('admin/bug-reports')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth()
export class AdminBugReportsController {
  constructor(private readonly bugReports: BugReportsService) {}

  @Get()
  @ApiOperation({ summary: 'List bug reports (admin)' })
  async list(@Query() query: QueryAdminBugReportsDto) {
    return this.bugReports.listAdmin(query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Bug report aggregates (admin)' })
  async stats() {
    return this.bugReports.statsAdmin();
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update bug report status / metadata (admin)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBugReportDto,
  ) {
    return this.bugReports.updateAdmin(id, dto);
  }
}
