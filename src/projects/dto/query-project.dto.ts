import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryProjectDto {
  @ApiPropertyOptional({
    description: 'Max number of records to return (default 50)',
    default: 50,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Number of records to skip (for pagination)',
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  skip?: number;
}
