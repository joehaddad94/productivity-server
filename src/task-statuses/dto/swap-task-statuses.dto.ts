import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class SwapTaskStatusesDto {
  @ApiProperty()
  @IsUUID()
  idA: string;

  @ApiProperty()
  @IsUUID()
  idB: string;
}
