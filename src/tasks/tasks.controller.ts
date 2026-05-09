import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  ParseIntPipe,
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
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { QueryTaskDto } from './dto/query-task.dto';
import { BulkTaskDto } from './dto/bulk-task.dto';

@ApiTags('tasks')
@Controller('workspaces/:workspaceId/tasks')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  @ApiOperation({ summary: 'List top-level tasks with nested subtasks' })
  @ApiResponse({ status: 200, description: 'List of tasks' })
  @ApiResponse({ status: 403, description: 'Not a workspace member' })
  async list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser() user: RequestUser,
    @Query() query: QueryTaskDto,
  ) {
    return this.tasksService.list(workspaceId, user.id, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a task' })
  @ApiResponse({ status: 201, description: 'Task created' })
  @ApiResponse({ status: 403, description: 'Not a workspace member' })
  async create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateTaskDto,
  ) {
    const task = await this.tasksService.create(workspaceId, user.id, dto);
    return { task };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a task with subtasks' })
  @ApiResponse({ status: 200, description: 'Task details with subtasks' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async findOne(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    const task = await this.tasksService.findOne(workspaceId, id, user.id);
    return { task };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a task' })
  @ApiResponse({ status: 200, description: 'Task updated' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateTaskDto,
  ) {
    const task = await this.tasksService.update(workspaceId, id, user.id, dto);
    return { task };
  }

  @Post(':id/log-focus')
  @ApiOperation({
    summary: 'Increment per-task focus minutes and log to daily analytics',
  })
  @ApiResponse({ status: 201, description: 'Focus minutes logged' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async logFocus(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Body('minutes', ParseIntPipe) minutes: number,
  ) {
    const task = await this.tasksService.logFocus(
      workspaceId,
      id,
      user.id,
      minutes,
    );
    return { task };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete a task' })
  @ApiResponse({ status: 200, description: 'Task soft-deleted' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    await this.tasksService.remove(workspaceId, id, user.id);
    return { success: true };
  }

  @Post('bulk')
  @ApiOperation({ summary: 'Bulk complete or delete tasks (max 100)' })
  @ApiResponse({ status: 200, description: '{ affected: number }' })
  @ApiResponse({ status: 403, description: 'Not a workspace member' })
  async bulk(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: BulkTaskDto,
  ) {
    return this.tasksService.bulkUpdate(workspaceId, user.id, dto);
  }

  @Post('reorder')
  @ApiOperation({ summary: 'Reorder tasks — supply ordered array of task IDs' })
  @ApiResponse({ status: 200, description: 'Tasks reordered' })
  @ApiResponse({ status: 403, description: 'Not a workspace member' })
  async reorder(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser() user: RequestUser,
    @Body() body: { ids: string[] },
  ) {
    await this.tasksService.reorder(workspaceId, user.id, body.ids);
    return { success: true };
  }
}
