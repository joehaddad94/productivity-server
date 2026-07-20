import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum MeTasksLens {
  List = 'list',
  Calendar = 'calendar',
}

export class QueryMeTasksDto {
  @ApiPropertyOptional({
    enum: MeTasksLens,
    default: MeTasksLens.List,
    description:
      'list = full cross-workspace list (client groups by date); calendar = dated tasks in the given range',
  })
  @IsOptional()
  @IsEnum(MeTasksLens)
  lens?: MeTasksLens;

  @ApiPropertyOptional({ description: 'ISO date — include tasks due on/before' })
  @IsOptional()
  @IsString()
  dueBefore?: string;

  @ApiPropertyOptional({ description: 'ISO date — include tasks due on/after' })
  @IsOptional()
  @IsString()
  dueAfter?: string;

  @ApiPropertyOptional({ description: 'Max records to return (default 200, max 500)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({ description: 'Records to skip (pagination)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  skip?: number;
}
