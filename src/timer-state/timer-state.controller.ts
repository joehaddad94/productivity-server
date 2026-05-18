import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, RequestUser } from '../auth/decorators/current-user.decorator';
import { TimerStateService } from './timer-state.service';
import { UpdateTimerStateDto } from './dto/update-timer-state.dto';

@ApiTags('timer-state')
@Controller('timer-state')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TimerStateController {
  constructor(private readonly timerStateService: TimerStateService) {}

  @Get()
  @ApiOperation({ summary: 'Get current timer state for the authenticated user' })
  get(@CurrentUser() user: RequestUser) {
    return this.timerStateService.get(user.id);
  }

  @Patch()
  @ApiOperation({ summary: 'Create or update timer state for the authenticated user' })
  update(@CurrentUser() user: RequestUser, @Body() dto: UpdateTimerStateDto) {
    return this.timerStateService.upsert(user.id, dto);
  }
}
