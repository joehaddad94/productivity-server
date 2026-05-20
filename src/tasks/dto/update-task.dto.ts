import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, Min, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateTaskDto } from './create-task.dto';

export class UpdateTaskDto extends PartialType(CreateTaskDto) {
  @ApiPropertyOptional({ description: 'Manual sort order (lower = earlier)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  sortOrder?: number;

  @ApiPropertyOptional({
    description: 'UTC ISO datetime to fire a reminder notification. Null clears it.',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((o) => o.remindAt !== null)
  @IsDateString()
  remindAt?: string | null;
}
