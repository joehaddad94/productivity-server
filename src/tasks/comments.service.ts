import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertMember } from '../common/assert-member';

export type ThreadItem =
  | {
      kind: 'comment';
      id: string;
      userId: string;
      userName: string | null;
      userAvatarUrl: string | null;
      content: string;
      createdAt: string;
      updatedAt: string;
    }
  | {
      kind: 'activity';
      id: string;
      userId: string;
      userName: string | null;
      userAvatarUrl: string | null;
      type: string;
      metadata: unknown;
      createdAt: string;
    };

@Injectable()
export class CommentsService {
  constructor(private readonly prisma: PrismaService) {}

  async getThread(
    workspaceId: string,
    taskId: string,
    userId: string,
  ): Promise<ThreadItem[]> {
    await assertMember(this.prisma, workspaceId, userId);

    const task = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId, deletedAt: null },
    });
    if (!task) throw new NotFoundException('Task not found');

    const [comments, activities] = await Promise.all([
      this.prisma.taskComment.findMany({
        where: { taskId },
        include: { user: { select: { id: true, name: true, avatarUrl: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.taskActivity.findMany({
        where: { taskId },
        include: { user: { select: { id: true, name: true, avatarUrl: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const items: ThreadItem[] = [
      ...comments.map((c) => ({
        kind: 'comment' as const,
        id: c.id,
        userId: c.userId,
        userName: c.user.name,
        userAvatarUrl: c.user.avatarUrl,
        content: c.content,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
      ...activities.map((a) => ({
        kind: 'activity' as const,
        id: a.id,
        userId: a.userId,
        userName: a.user.name,
        userAvatarUrl: a.user.avatarUrl,
        type: a.type,
        metadata: a.metadata,
        createdAt: a.createdAt.toISOString(),
      })),
    ];

    items.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    return items;
  }

  async createComment(
    workspaceId: string,
    taskId: string,
    userId: string,
    content: string,
  ): Promise<ThreadItem> {
    const { role } = await assertMember(this.prisma, workspaceId, userId);

    const task = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId, deletedAt: null },
    });
    if (!task) throw new NotFoundException('Task not found');

    // Owner/admin can always comment; members can only comment if assigned
    if (role === 'member') {
      const assignment = await this.prisma.taskAssignee.findUnique({
        where: { taskId_userId: { taskId, userId } },
      });
      if (!assignment) {
        throw new ForbiddenException(
          'Only owner, admin, or an assignee can comment on a task',
        );
      }
    }

    const comment = await this.prisma.taskComment.create({
      data: { taskId, userId, content },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    });

    return {
      kind: 'comment',
      id: comment.id,
      userId: comment.userId,
      userName: comment.user.name,
      userAvatarUrl: comment.user.avatarUrl,
      content: comment.content,
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
    };
  }

  async deleteComment(
    workspaceId: string,
    taskId: string,
    commentId: string,
    userId: string,
  ): Promise<void> {
    await assertMember(this.prisma, workspaceId, userId);

    const comment = await this.prisma.taskComment.findFirst({
      where: { id: commentId, taskId },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.userId !== userId) {
      throw new ForbiddenException('You can only delete your own comments');
    }

    await this.prisma.taskComment.delete({ where: { id: commentId } });
  }
}
