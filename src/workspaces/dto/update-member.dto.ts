import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateMemberDto {
  @ApiPropertyOptional({ example: 'admin', enum: ['admin', 'member'] })
  @IsOptional()
  @IsString()
  @IsIn(['admin', 'member'])
  role?: 'admin' | 'member';

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  canSeeAllTasks?: boolean;
}
