import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { randomBytes } from 'node:crypto';

const MAGIC_LINK_EXPIRES_MS = 15 * 60 * 1000; // 15 minutes

export interface ConsumedToken {
  email: string;
  name: string | null;
}

@Injectable()
export class MagicLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async createMagicLink(
    email: string,
    name?: string | null,
  ): Promise<{ magicLink: string }> {
    const normalized = email.toLowerCase().trim();
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRES_MS);
    await this.prisma.verificationToken.create({
      data: {
        email: normalized,
        name: name ?? null,
        token,
        expiresAt,
      } as Prisma.VerificationTokenCreateInput,
    });
    const baseUrl = this.config.get('APP_URL') ?? 'http://localhost:5173';
    const magicLink = `${baseUrl}/verify?token=${token}`;
    return { magicLink };
  }

  /**
   * Find token, validate expiry, return email + name and delete token.
   * @throws BadRequestException if invalid or expired
   */
  async consumeToken(token: string): Promise<ConsumedToken> {
    const record = await this.prisma.verificationToken.findUnique({
      where: { token },
    });
    if (!record) {
      throw new BadRequestException('Invalid or expired link');
    }
    if (record.expiresAt < new Date()) {
      await this.prisma.verificationToken
        .delete({ where: { id: record.id } })
        .catch(() => {});
      throw new BadRequestException('Link has expired');
    }
    const tokenRecord = record as { email: string; name?: string | null };
    await this.prisma.verificationToken.delete({ where: { id: record.id } });
    return {
      email: tokenRecord.email,
      name: tokenRecord.name ?? null,
    };
  }
}
