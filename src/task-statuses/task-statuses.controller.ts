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
import { TaskStatusesService } from './task-statuses.service';
import { CreateTaskStatusDto } from './dto/create-task-status.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { SwapTaskStatusesDto } from './dto/swap-task-statuses.dto';

@ApiTags('task-statuses')
@Controller('workspaces/:workspaceId/task-statuses')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TaskStatusesController {
  constructor(private readonly taskStatusesService: TaskStatusesService) {}

  @Get()
  @ApiOperation({ summary: 'List workspace task statuses (columns)' })
  @ApiResponse({ status: 200, description: '{ statuses: TaskStatus[] }' })
  async list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.taskStatusesService.list(workspaceId, user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a task status' })
  @ApiResponse({ status: 201, description: '{ status }' })
  async create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateTaskStatusDto,
  ) {
    return this.taskStatusesService.create(workspaceId, user.id, dto);
  }

  @Post('swap')
  @ApiOperation({ summary: 'Atomically swap the sortOrder of two statuses' })
  @ApiResponse({ status: 200, description: '{ statuses: [statusA, statusB] }' })
  async swap(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SwapTaskStatusesDto,
  ) {
    return this.taskStatusesService.swap(
      workspaceId,
      user.id,
      dto.idA,
      dto.idB,
    );
  }

  @Patch(':statusId')
  @ApiOperation({ summary: 'Update a task status' })
  @ApiResponse({ status: 200, description: '{ status }' })
  async update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('statusId', ParseUUIDPipe) statusId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateTaskStatusDto,
  ) {
    return this.taskStatusesService.update(workspaceId, statusId, user.id, dto);
  }

  @Delete(':statusId')
  @ApiOperation({ summary: 'Delete a task status (optional task migration)' })
  @ApiResponse({ status: 200, description: 'Removed' })
  async remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('statusId', ParseUUIDPipe) statusId: string,
    @CurrentUser() user: RequestUser,
    @Query('replacementTaskStatusId') replacementTaskStatusId?: string,
  ) {
    await this.taskStatusesService.remove(
      workspaceId,
      statusId,
      user.id,
      replacementTaskStatusId,
    );
    return { success: true };
  }
}
