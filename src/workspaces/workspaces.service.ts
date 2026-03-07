import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Workspace } from '@prisma/client';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Generate URL-safe slug from name */
  private slugify(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }

  /** Ensure slug is unique; if taken, append short id */
  private async ensureUniqueSlug(slug: string, excludeId?: string): Promise<string> {
    const existing = await this.prisma.workspace.findFirst({
      where: {
        slug,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (!existing) return slug;
    const suffix = Math.random().toString(36).slice(2, 8);
    return this.ensureUniqueSlug(`${slug}-${suffix}`, excludeId);
  }

  async create(dto: CreateWorkspaceDto, userId: string): Promise<Workspace> {
    const slug =
      dto.slug?.trim() || this.slugify(dto.name) || 'workspace';
    const uniqueSlug = await this.ensureUniqueSlug(slug);

    const workspace = await this.prisma.workspace.create({
      data: {
        name: dto.name.trim(),
        slug: uniqueSlug,
        isPersonal: dto.isPersonal ?? false,
      },
    });

    await this.prisma.workspaceMember.create({
      data: {
        userId,
        workspaceId: workspace.id,
        role: 'owner',
      },
    });

    return workspace;
  }

  async findByUserId(userId: string): Promise<Workspace[]> {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
    });
    return memberships.map((m) => m.workspace);
  }

  async findOne(id: string, userId: string): Promise<Workspace> {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: { userId, workspaceId: id },
      },
      include: { workspace: true },
    });
    if (!membership) throw new NotFoundException('Workspace not found');
    return membership.workspace;
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateWorkspaceDto,
  ): Promise<Workspace> {
    await this.findOne(id, userId);

    const data: { name?: string; slug?: string; isPersonal?: boolean } = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.isPersonal !== undefined) data.isPersonal = dto.isPersonal;
    if (dto.slug !== undefined) {
      data.slug = await this.ensureUniqueSlug(dto.slug.trim(), id);
    }

    return this.prisma.workspace.update({
      where: { id },
      data,
    });
  }

  async remove(id: string, userId: string): Promise<void> {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: { userId, workspaceId: id },
      },
    });
    if (!membership) throw new NotFoundException('Workspace not found');
    if (membership.role !== 'owner') {
      throw new ForbiddenException('Only the workspace owner can delete it');
    }

    await this.prisma.workspace.delete({ where: { id } });
  }
}
