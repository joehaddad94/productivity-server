import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { createHash, randomBytes } from 'node:crypto';

const MAGIC_LINK_EXPIRES_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Magic-link tokens are bearer credentials: whoever holds one can sign in as
 * that email. They were stored verbatim, so anyone who could read the table —
 * a backup, a replica, a support query, a leaked log — held a working login
 * for every link still in flight.
 *
 * Store only the hash and email the raw value, so the database never contains
 * anything that can be used to authenticate. A plain SHA-256 is the right
 * tool here rather than a password KDF: the input is 256 bits of CSPRNG
 * output, so there is nothing to brute force and nothing to salt.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

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
        token: hashToken(token),
        expiresAt,
      } as Prisma.VerificationTokenCreateInput,
    });
    const baseUrl =
      this.config.get<string>('APP_URL') ?? 'http://localhost:5173';
    const magicLink = `${baseUrl}/verify?token=${token}`;
    return { magicLink };
  }

  /**
   * Find token, validate expiry, return email + name and delete token.
   * @throws BadRequestException if invalid or expired
   */
  async consumeToken(token: string): Promise<ConsumedToken> {
    const record = await this.prisma.verificationToken.findUnique({
      where: { token: hashToken(token) },
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
