import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { CreateNoteDto } from './create-note.dto';

/**
 * Relation fields (taskId/projectId/assigneeId) are stripped out of the
 * PartialType so we can re-declare them with `ValidateIf(v !== null)`.
 * This lets clients send `null` to unlink a relation while still rejecting
 * other invalid values.
 */
export class UpdateNoteDto extends PartialType(
  OmitType(CreateNoteDto, ['taskId', 'projectId', 'assigneeId'] as const),
) {
  @ApiPropertyOptional({
    nullable: true,
    description: 'UUID of the linked task, or null to unlink.',
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  taskId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'UUID of the linked project, or null to unlink.',
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  projectId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'UUID of the assignee, or null to unassign.',
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  assigneeId?: string | null;
}
