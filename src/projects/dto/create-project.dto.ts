import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateProjectDto {
  @ApiProperty({ example: 'My Project' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    enum: ['active', 'on_hold', 'completed'],
    default: 'active',
  })
  @IsOptional()
  @IsIn(['active', 'on_hold', 'completed'])
  status?: string;

  @ApiPropertyOptional({ example: 'blue' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  color?: string;
}
