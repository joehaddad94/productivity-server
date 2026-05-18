import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Min, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateTaskDto, RecurrenceRule } from './create-task.dto';

export class UpdateTaskDto extends PartialType(CreateTaskDto) {
  @ApiPropertyOptional({ description: 'Manual sort order (lower = earlier)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  sortOrder?: number;

  // Override to allow null (clears the recurrence rule)
  @ApiPropertyOptional({ enum: RecurrenceRule, nullable: true })
  @IsOptional()
  @ValidateIf((o) => o.recurrenceRule !== null)
  @IsEnum(RecurrenceRule)
  recurrenceRule?: RecurrenceRule | null;
}
