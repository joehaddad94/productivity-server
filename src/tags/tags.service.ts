import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Note } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertMember } from '../common/assert-member';

const MAX_TAG_LENGTH = 40;

export interface WorkspaceTagCount {
  tag: string;
  count: number;
}

@Injectable()
export class TagsService {
  private readonly logger = new Logger(TagsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Trim, lowercase, strip empty, enforce length, dedup while preserving order. */
  private normalizeTags(raw: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of raw) {
      if (typeof t !== 'string') continue;
      const n = t.trim().toLowerCase();
      if (!n) continue;
      if (n.length > MAX_TAG_LENGTH) {
        throw new BadRequestException(
          `Tag "${n}" exceeds ${MAX_TAG_LENGTH} characters`,
        );
      }
      if (!seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
    return out;
  }

  private normalizeTag(raw: string): string {
    const [normalized] = this.normalizeTags([raw]);
    if (!normalized) {
      throw new BadRequestException('Tag must be a non-empty string');
    }
    return normalized;
  }

  async addTags(
    workspaceId: string,
    noteId: string,
    userId: string,
    tags: string[],
  ): Promise<Note> {
    await assertMember(this.prisma, workspaceId, userId);
    const incoming = this.normalizeTags(tags);
    if (!incoming.length) {
      throw new BadRequestException('No valid tags provided');
    }

    const note = await this.prisma.note.findFirst({
      where: { id: noteId, workspaceId },
    });
    if (!note) throw new NotFoundException('Note not found');

    const existing = new Set(note.tags.map((t) => t.toLowerCase()));
    const merged = [...note.tags];
    for (const t of incoming) {
      if (!existing.has(t)) {
        merged.push(t);
        existing.add(t);
      }
    }
    if (merged.length === note.tags.length) {
      return note;
    }

    const updated = await this.prisma.note.update({
      where: { id: noteId },
      data: { tags: merged },
    });
    this.logger.log(
      `addTags workspace=${workspaceId} note=${noteId} added=${incoming.length}`,
    );
    return updated;
  }

  async removeTag(
    workspaceId: string,
    noteId: string,
    userId: string,
    tag: string,
  ): Promise<Note> {
    await assertMember(this.prisma, workspaceId, userId);
    const target = this.normalizeTag(tag);

    const note = await this.prisma.note.findFirst({
      where: { id: noteId, workspaceId },
    });
    if (!note) throw new NotFoundException('Note not found');

    const next = note.tags.filter((t) => t.toLowerCase() !== target);
    if (next.length === note.tags.length) {
      return note;
    }

    const updated = await this.prisma.note.update({
      where: { id: noteId },
      data: { tags: next },
    });
    this.logger.log(
      `removeTag workspace=${workspaceId} note=${noteId} tag=${target}`,
    );
    return updated;
  }

  async listWorkspaceTags(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceTagCount[]> {
    await assertMember(this.prisma, workspaceId, userId);

    const rows = await this.prisma.$queryRaw<
      Array<{ tag: string; count: bigint | number }>
    >(
      Prisma.sql`
        SELECT unnest(tags) AS tag, COUNT(*)::int AS count
        FROM notes
        WHERE workspace_id = ${workspaceId}
        GROUP BY tag
        ORDER BY count DESC, tag ASC
      `,
    );

    return rows.map((r) => ({
      tag: r.tag,
      count: typeof r.count === 'bigint' ? Number(r.count) : r.count,
    }));
  }

  async renameTag(
    workspaceId: string,
    userId: string,
    from: string,
    to: string,
  ): Promise<{ renamed: number }> {
    await assertMember(this.prisma, workspaceId, userId);
    const fromN = this.normalizeTag(from);
    const toN = this.normalizeTag(to);
    if (fromN === toN) return { renamed: 0 };

    const result = await this.prisma.$executeRaw(
      Prisma.sql`
        UPDATE notes
        SET tags = (
          SELECT COALESCE(array_agg(DISTINCT t ORDER BY t), ARRAY[]::text[])
          FROM unnest(
            CASE
              WHEN ${toN} = ANY(tags)
                THEN array_remove(tags, ${fromN})
              ELSE array_replace(tags, ${fromN}, ${toN})
            END
          ) AS t
        )
        WHERE workspace_id = ${workspaceId} AND ${fromN} = ANY(tags)
      `,
    );

    this.logger.log(
      `renameTag workspace=${workspaceId} from=${fromN} to=${toN} affected=${result}`,
    );
    return { renamed: Number(result) };
  }

  async deleteTag(
    workspaceId: string,
    userId: string,
    tag: string,
  ): Promise<{ affected: number }> {
    await assertMember(this.prisma, workspaceId, userId);
    const target = this.normalizeTag(tag);

    const result = await this.prisma.$executeRaw(
      Prisma.sql`
        UPDATE notes
        SET tags = array_remove(tags, ${target})
        WHERE workspace_id = ${workspaceId} AND ${target} = ANY(tags)
      `,
    );

    this.logger.log(
      `deleteTag workspace=${workspaceId} tag=${target} affected=${result}`,
    );
    return { affected: Number(result) };
  }
}
