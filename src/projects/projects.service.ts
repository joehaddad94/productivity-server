import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Project } from '@prisma/client';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { QueryProjectDto } from './dto/query-project.dto';

type ProjectWithCount = Project & { _count: { notes: number; tasks: number } };

@Injectable()
export class ProjectsService {
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
    query: QueryProjectDto = {},
  ): Promise<{ projects: ProjectWithCount[]; total: number }> {
    await this.assertMember(workspaceId, userId);

    const limit = query.limit ?? 50;
    const skip = query.skip ?? 0;
    const where = { workspaceId };

    const [projects, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        include: { _count: { select: { notes: true, tasks: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      this.prisma.project.count({ where }),
    ]);

    return { projects: projects as ProjectWithCount[], total };
  }

  async create(workspaceId: string, userId: string, dto: CreateProjectDto): Promise<Project> {
    await this.assertMember(workspaceId, userId);

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

  async findOne(workspaceId: string, id: string, userId: string): Promise<ProjectWithCount> {
    await this.assertMember(workspaceId, userId);

    const project = await this.prisma.project.findFirst({
      where: { id, workspaceId },
      include: { _count: { select: { notes: true, tasks: true } } },
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
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
      },
      include: { _count: { select: { notes: true, tasks: true } } },
    }) as ProjectWithCount;
  }

  async remove(workspaceId: string, id: string, userId: string): Promise<void> {
    await this.findOne(workspaceId, id, userId);
    await this.prisma.project.delete({ where: { id } });
  }
}
