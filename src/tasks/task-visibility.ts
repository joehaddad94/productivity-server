import { Prisma } from '@prisma/client';
import type { WorkspaceRole } from '../common/assert-member';

/**
 * Returns a Prisma WHERE fragment that restricts task visibility based on the
 * requester's role. Visibility keys off a task's ASSIGNMENT STATE, not on who
 * happens to be "involved":
 *
 *   - A task with NO assignees is private to its creator (a personal draft).
 *   - A task with ≥1 assignee is visible to the whole leadership layer.
 *
 *   owner / admin  → every assigned task in the workspace, PLUS their own
 *                    (unassigned) tasks. Owner and admin are identical here;
 *                    "owner" only means they created the workspace.
 *   member         → tasks assigned to them, PLUS tasks they created.
 *
 * Self-assigning is therefore the act that promotes a private draft into a
 * task the owner/admins can see.
 */
export function buildTaskVisibilityWhere(
  userId: string,
  role: WorkspaceRole,
): Prisma.TaskWhereInput {
  if (role === 'owner' || role === 'admin') {
    return {
      OR: [
        { assignees: { some: {} } },
        { creatorId: userId },
      ],
    };
  }
  return {
    OR: [
      { creatorId: userId },
      { assignees: { some: { userId } } },
    ],
  };
}

/**
 * Returns a Prisma WHERE fragment for tasks the user should be NOTIFIED about,
 * regardless of role: creator, assignee, or assigner. Kept separate from
 * visibility on purpose — an owner/admin can SEE every assigned task, but
 * should only be reminded about the ones they created, were assigned, or
 * assigned to someone else.
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
