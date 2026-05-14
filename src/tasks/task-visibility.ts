import { Prisma } from '@prisma/client';
import type { WorkspaceRole } from '../common/assert-member';

/**
 * Returns a Prisma WHERE fragment that restricts task visibility based on
 * the requester's role and canSeeAllTasks flag.
 *
 *   owner / admin  → tasks they created OR tasks they assigned to others
 *   member + canSeeAllTasks=true   → all workspace tasks (empty fragment)
 *   member + canSeeAllTasks=false  → tasks they created OR are assigned to
 */
export function buildTaskVisibilityWhere(
  userId: string,
  role: WorkspaceRole,
  canSeeAllTasks: boolean,
): Prisma.TaskWhereInput {
  if (role === 'owner' || role === 'admin') {
    return {
      OR: [
        { creatorId: userId },
        { assignees: { some: { assignedById: userId } } },
      ],
    };
  }
  if (canSeeAllTasks) return {};
  return {
    OR: [
      { creatorId: userId },
      { assignees: { some: { userId } } },
    ],
  };
}
