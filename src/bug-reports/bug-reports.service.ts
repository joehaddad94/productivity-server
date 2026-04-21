import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBugReportDto } from './dto/create-bug-report.dto';
import { UpdateBugReportDto } from './dto/update-bug-report.dto';
import { QueryAdminBugReportsDto } from './dto/query-admin-bug-reports.dto';

const OPEN_STATUSES = ['open', 'triaging'];

@Injectable()
export class BugReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
    const m = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });
    if (!m) throw new ForbiddenException('Not a member of this workspace');
  }

  private toApi(row: {
    id: string;
    userId: string;
    workspaceId: string | null;
    title: string;
    description: string;
    expected: string | null;
    actual: string | null;
    route: string | null;
    userAgent: string | null;
    contextJson: Prisma.JsonValue | null;
    status: string;
    priority: string | null;
    resolvedAt: Date | null;
    resolutionNote: string | null;
    createdAt: Date;
    updatedAt: Date;
    user?: { email: string; name: string | null };
  }) {
    return {
      id: row.id,
      userId: row.userId,
      workspaceId: row.workspaceId,
      title: row.title,
      description: row.description,
      expected: row.expected,
      actual: row.actual,
      route: row.route,
      userAgent: row.userAgent,
      contextJson: row.contextJson,
      status: row.status,
      priority: row.priority,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      resolutionNote: row.resolutionNote,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      reporterEmail: row.user?.email,
      reporterName: row.user?.name ?? null,
    };
  }

  async create(userId: string, dto: CreateBugReportDto) {
    if (dto.workspaceId) {
      await this.assertWorkspaceMember(dto.workspaceId, userId);
    }

    const row = await this.prisma.bugReport.create({
      data: {
        userId,
        workspaceId: dto.workspaceId ?? null,
        title: dto.title.trim(),
        description: dto.description.trim(),
        expected: dto.expected?.trim() || null,
        actual: dto.actual?.trim() || null,
        route: dto.route?.trim() || null,
        userAgent: dto.userAgent?.trim() || null,
        ...(dto.contextJson
          ? { contextJson: dto.contextJson as Prisma.InputJsonValue }
          : {}),
      },
    });

    return { bug: this.toApi(row) };
  }

  async listAdmin(query: QueryAdminBugReportsDto) {
    const limit = query.limit ?? 50;
    const skip = query.skip ?? 0;
    const where =
      query.status && query.status !== 'all' ? { status: query.status } : {};

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.bugReport.findMany({
        where,
        include: { user: { select: { email: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      this.prisma.bugReport.count({ where }),
    ]);

    return {
      bugs: rows.map((r) => this.toApi({ ...r, user: r.user })),
      total,
    };
  }

  async statsAdmin() {
    const byStatus = await this.prisma.bugReport.groupBy({
      by: ['status'],
      _count: { id: true },
    });

    const statusMap: Record<string, number> = {};
    for (const g of byStatus) {
      statusMap[g.status] = g._count.id;
    }

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const last7Days = await this.prisma.bugReport.count({
      where: { createdAt: { gte: sevenDaysAgo } },
    });

    const totalOpen = await this.prisma.bugReport.count({
      where: { status: { in: OPEN_STATUSES } },
    });

    const routeGroups = await this.prisma.bugReport.groupBy({
      by: ['route'],
      where: { route: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 8,
    });

    const topRoutes = routeGroups
      .filter((g) => g.route)
      .map((g) => ({ route: g.route as string, count: g._count.id }));

    return {
      byStatus: statusMap,
      totalOpen,
      last7Days,
      topRoutes,
    };
  }

  async updateAdmin(id: string, dto: UpdateBugReportDto) {
    const existing = await this.prisma.bugReport.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Bug report not found');

    const row = await this.prisma.bugReport.update({
      where: { id },
      data: {
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.resolutionNote !== undefined
          ? { resolutionNote: dto.resolutionNote }
          : {}),
        ...(dto.resolvedAt !== undefined
          ? {
              resolvedAt:
                dto.resolvedAt === null ? null : new Date(dto.resolvedAt),
            }
          : {}),
      },
      include: { user: { select: { email: true, name: true } } },
    });

    return { bug: this.toApi({ ...row, user: row.user }) };
  }
}
