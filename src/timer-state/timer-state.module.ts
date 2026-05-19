import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TimerStateController } from './timer-state.controller';
import { TimerStateService } from './timer-state.service';

@Module({
  imports: [AuthModule],
  controllers: [TimerStateController],
  providers: [TimerStateService],
})
export class TimerStateModule {}
