import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateWorkspaceDto {
  @ApiPropertyOptional({ example: 'Updated Workspace Name' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ example: 'updated-slug' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPersonal?: boolean;
}
