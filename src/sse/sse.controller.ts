import {
  Controller,
  ForbiddenException,
  Param,
  ParseUUIDPipe,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  RequestUser,
} from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { SseService } from './sse.service';

@Controller('sse')
@UseGuards(JwtAuthGuard)
export class SseController {
  constructor(
    private readonly sseService: SseService,
    private readonly prisma: PrismaService,
  ) {}

  @Sse('workspace/:workspaceId')
  async stream(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<Observable<MessageEvent>> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: user.id, workspaceId } },
      select: { userId: true },
    });
    if (!member) throw new ForbiddenException('Not a member of this workspace');

    return this.sseService.subscribe(workspaceId);
  }
}
