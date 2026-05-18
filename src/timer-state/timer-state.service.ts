import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateTimerStateDto } from './dto/update-timer-state.dto';
import type { UserTimerState } from '@prisma/client';

type TimerStateApi = {
  sessionType: 'work' | 'short_break' | 'long_break';
  startedAt: string | null;
  secondsLeft: number;
  sessionCount: number;
  totalFocusMinutes: number;
};

@Injectable()
export class TimerStateService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<TimerStateApi | null> {
    const row = await this.prisma.userTimerState.findUnique({ where: { userId } });
    return row ? this.toApi(row) : null;
  }

  async upsert(userId: string, dto: UpdateTimerStateDto): Promise<TimerStateApi> {
    const patch = {
      ...(dto.sessionType !== undefined ? { sessionType: dto.sessionType } : {}),
      ...(dto.startedAt !== undefined
        ? { startedAt: dto.startedAt ? new Date(dto.startedAt) : null }
        : {}),
      ...(dto.secondsLeft !== undefined ? { secondsLeft: dto.secondsLeft } : {}),
      ...(dto.sessionCount !== undefined ? { sessionCount: dto.sessionCount } : {}),
      ...(dto.totalFocusMinutes !== undefined ? { totalFocusMinutes: dto.totalFocusMinutes } : {}),
    };

    const row = await this.prisma.userTimerState.upsert({
      where: { userId },
      create: {
        userId,
        sessionType: 'work',
        startedAt: null,
        secondsLeft: 1500,
        sessionCount: 0,
        totalFocusMinutes: 0,
        ...patch,
      },
      update: patch,
    });

    return this.toApi(row);
  }

  private toApi(row: UserTimerState): TimerStateApi {
    return {
      sessionType: row.sessionType as TimerStateApi['sessionType'],
      startedAt: row.startedAt?.toISOString() ?? null,
      secondsLeft: row.secondsLeft,
      sessionCount: row.sessionCount,
      totalFocusMinutes: row.totalFocusMinutes,
    };
  }
}
