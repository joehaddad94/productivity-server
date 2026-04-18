import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RenameTagDto {
  @ApiProperty({ description: 'Existing tag name' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  from!: string;

  @ApiProperty({ description: 'New tag name' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  to!: string;
}
