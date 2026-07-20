import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  RequestUser,
} from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MeService } from './me.service';
import { QueryMeTasksDto } from './dto/query-me-tasks.dto';
import { CreateMeTaskDto } from './dto/create-me-task.dto';

@ApiTags('me')
@Controller('me')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Get('tasks')
  @ApiOperation({
    summary:
      'Personal cross-workspace rollup — tasks assigned to me anywhere plus tasks I created in a personal workspace',
  })
  @ApiResponse({ status: 200, description: '{ tasks, total }' })
  async tasks(
    @CurrentUser() user: RequestUser,
    @Query() query: QueryMeTasksDto,
  ) {
    return this.meService.getTasks(user.id, query);
  }

  @Post('tasks')
  @ApiOperation({
    summary:
      'Quick-add a task from the rollup (defaults to the personal workspace, self-assigned)',
  })
  @ApiResponse({ status: 201, description: 'Task created' })
  async createTask(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateMeTaskDto,
  ) {
    const task = await this.meService.quickAddTask(user.id, dto);
    return { task };
  }
}
