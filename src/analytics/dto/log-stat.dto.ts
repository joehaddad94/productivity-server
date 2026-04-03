import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class LogStatDto {
  @ApiPropertyOptional({ description: 'ISO date (defaults to today)' })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  tasksCompleted?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  focusMinutes?: number;
}
