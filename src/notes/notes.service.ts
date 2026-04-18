import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Note } from '@prisma/client';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { QueryNoteDto } from './dto/query-note.dto';

@Injectable()
export class NotesService {
  private readonly logger = new Logger(NotesService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async assertMember(workspaceId: string, userId: string): Promise<void> {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });
    if (!membership) {
      throw new ForbiddenException("You don't have access to this workspace");
    }
  }

  async list(
    workspaceId: string,
    userId: string,
    query: QueryNoteDto,
  ): Promise<{ notes: Note[]; total: number }> {
    const startedAt = Date.now();
    await this.assertMember(workspaceId, userId);

    const tagList = query.tags
      ? query.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : undefined;

    const where = {
      workspaceId,
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' as const } },
              { content: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(tagList?.length
        ? { tags: query.tagMode === 'all' ? { hasEvery: tagList } : { hasSome: tagList } }
        : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.taskId ? { taskId: query.taskId } : {}),
    };

    const limit = query.limit ?? 50;
    const skip = query.skip ?? 0;

    const [notes, total] = await this.prisma.$transaction([
      this.prisma.note.findMany({ where, orderBy: { updatedAt: 'desc' }, take: limit, skip }),
      this.prisma.note.count({ where }),
    ]);

    this.logger.log(
      `listNotes workspace=${workspaceId} user=${userId} notes=${notes.length}/${total} +${Date.now() - startedAt}ms`,
    );

    return { notes, total };
  }

  async create(workspaceId: string, userId: string, dto: CreateNoteDto): Promise<Note> {
    const startedAt = Date.now();
    await this.assertMember(workspaceId, userId);

    const note = await this.prisma.note.create({
      data: {
        workspaceId,
        title: dto.title.trim(),
        content: dto.content,
        tags: dto.tags ?? [],
        projectId: dto.projectId,
        taskId: dto.taskId,
        assigneeId: dto.assigneeId,
        status: dto.status,
      },
    });

    this.logger.log(
      `createNote workspace=${workspaceId} user=${userId} note=${note.id} +${Date.now() - startedAt}ms`,
    );

    return note;
  }

  async findOne(workspaceId: string, id: string, userId: string): Promise<Note> {
    await this.assertMember(workspaceId, userId);

    const note = await this.prisma.note.findFirst({
      where: { id, workspaceId },
    });
    if (!note) throw new NotFoundException('Note not found');
    return note;
  }

  async update(
    workspaceId: string,
    id: string,
    userId: string,
    dto: UpdateNoteDto,
  ): Promise<Note> {
    await this.findOne(workspaceId, id, userId);

    return this.prisma.note.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.content !== undefined ? { content: dto.content } : {}),
        ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
        // Relations: null → unlink, string → link, undefined → leave untouched.
        ...('projectId' in dto ? { projectId: dto.projectId ?? null } : {}),
        ...('taskId' in dto ? { taskId: dto.taskId ?? null } : {}),
        ...('assigneeId' in dto ? { assigneeId: dto.assigneeId ?? null } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });
  }

  async remove(workspaceId: string, id: string, userId: string): Promise<void> {
    await this.findOne(workspaceId, id, userId);
    await this.prisma.note.delete({ where: { id } });
  }
}
