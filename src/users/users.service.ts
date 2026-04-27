import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: this.normalizeEmail(email) },
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  async create(data: { email: string; name?: string | null }): Promise<User> {
    return this.prisma.user.create({
      data: {
        email: this.normalizeEmail(data.email),
        name: data.name ?? null,
      },
    });
  }

  async updateProfile(id: string, data: { name?: string; timezone?: string }): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() || null } : {}),
        ...(data.timezone !== undefined ? { timezone: data.timezone || null } : {}),
      },
    });
  }

  private normalizeEmail(email: string): string {
    return email.toLowerCase().trim();
  }
}
