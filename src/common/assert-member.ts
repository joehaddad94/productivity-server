import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { membershipCache, membershipKey } from './membership-cache';

export type WorkspaceRole = 'owner' | 'admin' | 'member';

/**
 * Verifies the user is a member of the workspace and returns their role.
 * Throws ForbiddenException if not a member.
 * Caches the role for 60s; cache is invalidated on member updates/removal.
 */
export async function assertMember(
  prisma: PrismaService,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole> {
  const key = membershipKey(userId, workspaceId);
  const cached = membershipCache.get(key);
  if (cached) return cached as WorkspaceRole;

  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  if (!membership) {
    throw new ForbiddenException("You don't have access to this workspace");
  }

  const role = membership.role as WorkspaceRole;
  membershipCache.set(key, role);
  return role;
}
