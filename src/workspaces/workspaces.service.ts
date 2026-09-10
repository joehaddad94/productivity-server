import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { membershipCache, membershipKey } from '../common/membership-cache';
import { assertMember } from '../common/assert-member';
import { MailService } from '../mail/mail.service';
import { TaskStatusesService } from '../task-statuses/task-statuses.service';
import { ConfigService } from '@nestjs/config';
import { Workspace, WorkspaceMember } from '@prisma/client';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';

type MemberWithUser = WorkspaceMember & {
  user: {
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
  };
};

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly taskStatuses: TaskStatusesService,
  ) {}

  /** Generate URL-safe slug from name */
  private slugify(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }

  /** Ensure slug is unique among non-deleted workspaces; if taken, append short id */
  private async ensureUniqueSlug(
    slug: string,
    excludeId?: string,
  ): Promise<string> {
    const existing = await this.prisma.workspace.findFirst({
      where: {
        slug,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (!existing) return slug;
    const suffix = Math.random().toString(36).slice(2, 8);
    return this.ensureUniqueSlug(`${slug}-${suffix}`, excludeId);
  }

  async create(dto: CreateWorkspaceDto, userId: string): Promise<Workspace> {
    const slug = dto.slug?.trim() || this.slugify(dto.name) || 'workspace';

    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
    });
    const userSlugs = memberships.map((m) => m.workspace.slug);
    if (userSlugs.includes(slug)) {
      throw new ConflictException(
        'You already have a workspace with this name or slug',
      );
    }

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
    membershipCache.set(membershipKey(userId, workspace.id), {
      role: 'owner',
    });

    await this.taskStatuses.seedDefaultsForWorkspace(workspace.id);

    return workspace;
  }

  async findByUserId(userId: string): Promise<Workspace[]> {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId, workspace: { deletedAt: null } },
      include: { workspace: true },
    });
    return memberships.map((m) => m.workspace);
  }

  async findOne(id: string, userId: string): Promise<Workspace> {
    const membership = await this.prisma.workspaceMember.findFirst({
      where: { userId, workspaceId: id, workspace: { deletedAt: null } },
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

    // Renaming a workspace, changing its slug or flipping isPersonal are
    // administrative acts, but this only checked membership — so any member
    // could do all three, while deleting and inviting were already owner-only.
    //
    // isPersonal is the one that matters most: MeService picks the personal
    // workspace by that flag and the rollup's creator branch is scoped to it,
    // so flipping it changes what surfaces in other people's My Tasks.
    const { role } = await assertMember(this.prisma, id, userId);
    if (role !== 'owner' && role !== 'admin') {
      throw new ForbiddenException(
        'Only the workspace owner or an admin can update it',
      );
    }
    if (dto.isPersonal !== undefined && role !== 'owner') {
      throw new ForbiddenException(
        'Only the workspace owner can change whether it is personal',
      );
    }

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
    const { role } = await assertMember(this.prisma, id, userId);
    if (role !== 'owner') {
      throw new ForbiddenException('Only the workspace owner can delete it');
    }

    await this.prisma.workspace.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // --- Member management ---

  async listMembers(
    workspaceId: string,
    requesterId: string,
  ): Promise<MemberWithUser[]> {
    await assertMember(this.prisma, workspaceId, requesterId);

    return this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: {
          select: { id: true, email: true, name: true, avatarUrl: true },
        },
      },
    }) as Promise<MemberWithUser[]>;
  }

  async inviteMember(
    workspaceId: string,
    requesterId: string,
    dto: InviteMemberDto,
  ): Promise<{ invited: boolean; message: string }> {
    const { role } = await assertMember(this.prisma, workspaceId, requesterId);
    if (role !== 'owner') {
      throw new ForbiddenException(
        'Only the workspace owner can invite members',
      );
    }

    const workspace = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, deletedAt: null },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      // Check if already a member
      const existing = await this.prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: { userId: existingUser.id, workspaceId },
        },
      });
      if (existing) {
        return {
          invited: false,
          message: 'User is already a member of this workspace',
        };
      }

      await this.prisma.workspaceMember.create({
        data: { userId: existingUser.id, workspaceId, role: 'member' },
      });

      // Already a member at this point — no accept step, so don't send an "invite"
      const appUrl =
        this.config.get<string>('APP_URL') ?? 'http://localhost:3000';
      await this.mail.sendAddedToWorkspaceEmail(
        dto.email,
        workspace.name,
        `${appUrl}/dashboard`,
        existingUser.name,
      );

      return { invited: true, message: 'User added to workspace' };
    }

    // User doesn't exist: send invite link
    const appUrl =
      this.config.get<string>('APP_URL') ?? 'http://localhost:3000';
    const inviteLink = `${appUrl}/signup?email=${encodeURIComponent(dto.email)}&workspace=${workspaceId}`;

    await this.mail.sendInviteEmail(
      dto.email,
      workspace.name,
      inviteLink,
      null,
    );

    return { invited: true, message: 'Invite email sent' };
  }

  async removeMember(
    workspaceId: string,
    requesterId: string,
    targetUserId: string,
  ): Promise<void> {
    const { role: requesterRole } = await assertMember(
      this.prisma,
      workspaceId,
      requesterId,
    );
    if (requesterRole !== 'owner') {
      throw new ForbiddenException(
        'Only the workspace owner can remove members',
      );
    }
    if (requesterId === targetUserId) {
      throw new BadRequestException('The owner cannot remove themselves');
    }

    const targetMembership = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
    });
    if (!targetMembership) throw new NotFoundException('Member not found');

    // Cleanup: unassign all their TaskAssignee rows, reassign tasks they
    // created to the workspace owner, then drop the workspace_member row.
    await this.prisma.$transaction([
      this.prisma.taskAssignee.deleteMany({
        where: {
          userId: targetUserId,
          task: { workspaceId },
        },
      }),
      this.prisma.task.updateMany({
        where: {
          workspaceId,
          creatorId: targetUserId,
          deletedAt: null,
        },
        data: { creatorId: requesterId },
      }),
      this.prisma.workspaceMember.delete({
        where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
      }),
    ]);
    membershipCache.delete(membershipKey(targetUserId, workspaceId));
  }

  async updateMember(
    workspaceId: string,
    requesterId: string,
    targetUserId: string,
    dto: UpdateMemberDto,
  ): Promise<WorkspaceMember> {
    if (dto.role === undefined) {
      throw new BadRequestException('Must provide a role');
    }

    const { role: requesterRole } = await assertMember(
      this.prisma,
      workspaceId,
      requesterId,
    );
    if (requesterRole !== 'owner') {
      throw new ForbiddenException(
        'Only the workspace owner can update members',
      );
    }

    const targetMembership = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
    });
    if (!targetMembership) throw new NotFoundException('Member not found');

    if (dto.role !== undefined && targetMembership.role === 'owner') {
      throw new BadRequestException("Cannot change the owner's role");
    }

    const updated = await this.prisma.workspaceMember.update({
      where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
      data: { role: dto.role },
    });

    // Invalidate cache so the next request loads the new role
    membershipCache.delete(membershipKey(targetUserId, workspaceId));

    return updated;
  }
}
