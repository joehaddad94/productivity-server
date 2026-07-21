import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateMemberDto {
  @ApiPropertyOptional({ example: 'admin', enum: ['admin', 'member'] })
  @IsOptional()
  @IsString()
  @IsIn(['admin', 'member'])
  role?: 'admin' | 'member';
}
