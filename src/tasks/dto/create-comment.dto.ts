import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCommentDto {
  @ApiProperty({ example: 'Looks good to me.' })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content: string;
}
