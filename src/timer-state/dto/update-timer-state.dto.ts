import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsOptional, Min, ValidateIf } from 'class-validator';

export class UpdateTimerStateDto {
  @ApiPropertyOptional({ enum: ['work', 'short_break', 'long_break'] })
  @IsOptional()
  @IsIn(['work', 'short_break', 'long_break'])
  sessionType?: string;

  @ApiPropertyOptional({ nullable: true, description: 'ISO timestamp when the timer was started; null when paused' })
  @IsOptional()
  @ValidateIf((o) => o.startedAt !== null)
  @IsDateString()
  startedAt?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  secondsLeft?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sessionCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  totalFocusMinutes?: number;
}
