import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

const BUG_STATUSES = [
  'open',
  'triaging',
  'fixed',
  'wontfix',
  'duplicate',
] as const;

export class QueryAdminBugReportsDto {
  @ApiPropertyOptional({ enum: [...BUG_STATUSES, 'all'] })
  @IsOptional()
  @IsIn([...BUG_STATUSES, 'all'])
  status?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  skip?: number;
}
