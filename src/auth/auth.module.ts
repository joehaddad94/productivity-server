import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { BcryptPasswordHasher } from './services/bcrypt-password-hasher.service';
import { PASSWORD_HASHER } from './interfaces/password-hasher.interface';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    BcryptPasswordHasher,
    {
      provide: PASSWORD_HASHER,
      useClass: BcryptPasswordHasher,
    },
  ],
  exports: [AuthService, PASSWORD_HASHER],
})
export class AuthModule {}
