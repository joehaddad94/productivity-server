import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TaskPriority } from '../../tasks/dto/create-task.dto';

/**
 * Quick-add from the personal rollup. If `workspaceId` is omitted the task
 * lands in the user's personal workspace; the creator is always self-assigned
 * so it rolls back up into their day. See docs/task-model-and-rollup.md §6.2.
 */
export class CreateMeTaskDto {
  @ApiProperty({ example: 'Buy milk' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title: string;

  @ApiPropertyOptional({
    description: 'Target workspace; defaults to the personal workspace',
  })
  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'ISO date string' })
  @IsOptional()
  @IsString()
  dueDate?: string;

  @ApiPropertyOptional({ description: 'HH:MM time string' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'dueTime must be HH:MM' })
  dueTime?: string;

  @ApiPropertyOptional({ enum: TaskPriority })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional({ description: 'Optional project within the workspace' })
  @IsOptional()
  @IsUUID()
  projectId?: string;
}
