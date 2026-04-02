import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class QueryAnalyticsDto {
  @ApiPropertyOptional({ description: 'ISO date — start of range' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date — end of range' })
  @IsOptional()
  @IsString()
  to?: string;
}
