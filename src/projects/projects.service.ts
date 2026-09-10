import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertMember } from '../common/assert-member';
import { Project } from '@prisma/client';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { QueryProjectDto } from './dto/query-project.dto';

type ProjectWithCount = Project & { _count: { notes: number; tasks: number } };

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    workspaceId: string,
    userId: string,
    query: QueryProjectDto = {},
  ): Promise<{ projects: ProjectWithCount[]; total: number }> {
    await assertMember(this.prisma, workspaceId, userId);

    const limit = query.limit ?? 50;
    const skip = query.skip ?? 0;
    const where = { workspaceId, deletedAt: null };

    const [projects, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        include: {
        _count: {
          select: {
            notes: true,
            // Tasks are soft-deleted, and an unfiltered _count counts every
            // related row — so deleted tasks kept inflating the project's
            // badge. Notes are hard-deleted and need no filter.
            tasks: { where: { deletedAt: null } },
          },
        },
      },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      this.prisma.project.count({ where }),
    ]);

    return { projects: projects as ProjectWithCount[], total };
  }

  async create(
    workspaceId: string,
    userId: string,
    dto: CreateProjectDto,
  ): Promise<Project> {
    await assertMember(this.prisma, workspaceId, userId);

    return this.prisma.project.create({
      data: {
        workspaceId,
        name: dto.name.trim(),
        description: dto.description,
        status: dto.status ?? 'active',
        color: dto.color,
      },
    });
  }

  async findOne(
    workspaceId: string,
    id: string,
    userId: string,
  ): Promise<ProjectWithCount> {
    await assertMember(this.prisma, workspaceId, userId);

    const project = await this.prisma.project.findFirst({
      where: { id, workspaceId, deletedAt: null },
      include: {
        _count: {
          select: {
            notes: true,
            // Tasks are soft-deleted, and an unfiltered _count counts every
            // related row — so deleted tasks kept inflating the project's
            // badge. Notes are hard-deleted and need no filter.
            tasks: { where: { deletedAt: null } },
          },
        },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project as ProjectWithCount;
  }

  async update(
    workspaceId: string,
    id: string,
    userId: string,
    dto: UpdateProjectDto,
  ): Promise<ProjectWithCount> {
    await this.findOne(workspaceId, id, userId);

    return this.prisma.project.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
      },
      include: {
        _count: {
          select: {
            notes: true,
            // Tasks are soft-deleted, and an unfiltered _count counts every
            // related row — so deleted tasks kept inflating the project's
            // badge. Notes are hard-deleted and need no filter.
            tasks: { where: { deletedAt: null } },
          },
        },
      },
    }) as unknown as ProjectWithCount;
  }

  async remove(workspaceId: string, id: string, userId: string): Promise<void> {
    await this.findOne(workspaceId, id, userId);
    await this.prisma.project.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
