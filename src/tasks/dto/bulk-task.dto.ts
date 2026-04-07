import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsEnum, IsUUID, ArrayMinSize, ArrayMaxSize } from 'class-validator';

export enum BulkTaskAction {
  COMPLETE = 'complete',
  DELETE = 'delete',
}

export class BulkTaskDto {
  @ApiProperty({ enum: BulkTaskAction, example: BulkTaskAction.COMPLETE })
  @IsEnum(BulkTaskAction)
  action: BulkTaskAction;

  @ApiProperty({ type: [String], example: ['uuid1', 'uuid2'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  ids: string[];
}
