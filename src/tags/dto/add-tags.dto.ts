import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

export class AddTagsDto {
  @ApiProperty({
    description: 'Tags to add to the note (case-insensitive, trimmed, deduped)',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  tags!: string[];
}
