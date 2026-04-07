import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryNoteDto {
  @ApiPropertyOptional({ description: 'Search in title and content' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Comma-separated tags to filter by' })
  @IsOptional()
  @IsString()
  tags?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Filter notes linked to a specific task' })
  @IsOptional()
  @IsUUID()
  taskId?: string;

  @ApiPropertyOptional({ description: 'Max number of records to return (default 50)', default: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({ description: 'Number of records to skip (for pagination)', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  skip?: number;
}
