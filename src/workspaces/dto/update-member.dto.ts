import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

export class UpdateMemberDto {
  @ApiProperty({ example: 'member', enum: ['owner', 'admin', 'member'] })
  @IsString()
  @IsIn(['owner', 'admin', 'member'])
  role: string;
}
