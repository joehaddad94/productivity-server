import { Prisma } from '@prisma/client';
import type { WorkspaceRole } from '../common/assert-member';

/**
 * Returns a Prisma WHERE fragment that restricts task visibility based on
 * the requester's role and canSeeAllTasks flag.
 *
 *   owner / admin  → tasks they created OR assigned to others OR assigned to them
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
        { assignees: { some: { userId } } },
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

/**
 * Returns a Prisma WHERE fragment for tasks the user should be NOTIFIED about,
 * regardless of role: creator, assignee, or assigner. Used by the notification
 * scheduler so e.g. an admin assigned to a task by someone else still gets a
 * due-date reminder, and members with canSeeAllTasks=true don't get spammed for
 * tasks they have nothing to do with.
 */
export function buildTaskRelevanceWhere(userId: string): Prisma.TaskWhereInput {
  return {
    OR: [
      { creatorId: userId },
      { assignees: { some: { userId } } },
      { assignees: { some: { assignedById: userId } } },
    ],
  };
}
