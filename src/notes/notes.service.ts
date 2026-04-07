import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Note } from '@prisma/client';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { QueryNoteDto } from './dto/query-note.dto';

@Injectable()
export class NotesService {
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
      ...(tagList?.length ? { tags: { hasSome: tagList } } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
    };

    const limit = query.limit ?? 50;
    const skip = query.skip ?? 0;

    const [notes, total] = await this.prisma.$transaction([
      this.prisma.note.findMany({ where, orderBy: { updatedAt: 'desc' }, take: limit, skip }),
      this.prisma.note.count({ where }),
    ]);

    return { notes, total };
  }

  async create(workspaceId: string, userId: string, dto: CreateNoteDto): Promise<Note> {
    await this.assertMember(workspaceId, userId);

    return this.prisma.note.create({
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
        ...(dto.projectId !== undefined ? { projectId: dto.projectId } : {}),
        ...(dto.taskId !== undefined ? { taskId: dto.taskId } : {}),
        ...(dto.assigneeId !== undefined ? { assigneeId: dto.assigneeId } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });
  }

  async remove(workspaceId: string, id: string, userId: string): Promise<void> {
    await this.findOne(workspaceId, id, userId);
    await this.prisma.note.delete({ where: { id } });
  }
}
