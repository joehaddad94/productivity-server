import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

const BUG_STATUSES = ['open', 'triaging', 'fixed', 'wontfix', 'duplicate'] as const;

export class UpdateBugReportDto {
  @ApiPropertyOptional({ enum: BUG_STATUSES })
  @IsOptional()
  @IsIn([...BUG_STATUSES])
  status?: (typeof BUG_STATUSES)[number];

  @ApiPropertyOptional({ enum: ['low', 'medium', 'high'] })
  @IsOptional()
  @IsIn(['low', 'medium', 'high'])
  priority?: 'low' | 'medium' | 'high';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  resolutionNote?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsISO8601()
  resolvedAt?: string | null;
}
