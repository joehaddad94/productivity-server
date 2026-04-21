import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BugReportsService } from './bug-reports.service';
import { CreateBugReportDto } from './dto/create-bug-report.dto';

@ApiTags('bug-reports')
@Controller('bug-reports')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class BugReportsController {
  constructor(private readonly bugReports: BugReportsService) {}

  @Post()
  @ApiOperation({ summary: 'Submit a bug report (authenticated user)' })
  @ApiResponse({ status: 201, description: '{ bug }' })
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateBugReportDto) {
    return this.bugReports.create(user.id, dto);
  }
}
