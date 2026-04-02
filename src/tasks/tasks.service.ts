import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Task } from '@prisma/client';
import { CreateTaskDto, TaskStatus } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { QueryTaskDto } from './dto/query-task.dto';

type TaskWithSubtasks = Task & { subtasks: Task[] };

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertMember(workspaceId: string, userId: string): Promise<void> {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });
    if (!membership) {
      throw new ForbiddenException('You are not a member of this workspace');
    }
  }

  async list(
    workspaceId: string,
    userId: string,
    query: QueryTaskDto,
  ): Promise<TaskWithSubtasks[]> {
    await this.assertMember(workspaceId, userId);

    const tasks = await this.prisma.task.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        parentTaskId: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.priority ? { priority: query.priority } : {}),
        ...(query.search
          ? {
              OR: [
                { title: { contains: query.search, mode: 'insensitive' } },
                { description: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(query.dueBefore || query.dueAfter
          ? {
              dueDate: {
                ...(query.dueBefore ? { lte: new Date(query.dueBefore) } : {}),
                ...(query.dueAfter ? { gte: new Date(query.dueAfter) } : {}),
              },
            }
          : {}),
      },
      include: {
        subtasks: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return tasks as TaskWithSubtasks[];
  }

  async create(
    workspaceId: string,
    userId: string,
    dto: CreateTaskDto,
  ): Promise<Task> {
    await this.assertMember(workspaceId, userId);

    return this.prisma.task.create({
      data: {
        workspaceId,
        title: dto.title.trim(),
        description: dto.description,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        priority: dto.priority,
        status: dto.status ?? TaskStatus.PENDING,
        parentTaskId: dto.parentTaskId,
        completedAt:
          dto.status === TaskStatus.COMPLETED ? new Date() : undefined,
      },
    });
  }

  async findOne(
    workspaceId: string,
    id: string,
    userId: string,
  ): Promise<TaskWithSubtasks> {
    await this.assertMember(workspaceId, userId);

    const task = await this.prisma.task.findFirst({
      where: { id, workspaceId, deletedAt: null },
      include: {
        subtasks: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task as TaskWithSubtasks;
  }

  async update(
    workspaceId: string,
    id: string,
    userId: string,
    dto: UpdateTaskDto,
  ): Promise<Task> {
    await this.findOne(workspaceId, id, userId);

    const isCompleting = dto.status === TaskStatus.COMPLETED;

    return this.prisma.task.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.dueDate !== undefined
          ? { dueDate: dto.dueDate ? new Date(dto.dueDate) : null }
          : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.parentTaskId !== undefined ? { parentTaskId: dto.parentTaskId } : {}),
        ...(isCompleting ? { completedAt: new Date() } : {}),
      },
    });
  }

  async remove(workspaceId: string, id: string, userId: string): Promise<void> {
    await this.findOne(workspaceId, id, userId);
    await this.prisma.task.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
