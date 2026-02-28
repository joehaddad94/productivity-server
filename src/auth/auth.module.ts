import { Module } from '@nestjs/common';
import { BcryptPasswordHasher } from './services/bcrypt-password-hasher.service';
import { PASSWORD_HASHER } from './interfaces/password-hasher.interface';

@Module({
  providers: [
    BcryptPasswordHasher,
    {
      provide: PASSWORD_HASHER,
      useClass: BcryptPasswordHasher,
    },
  ],
  exports: [PASSWORD_HASHER],
})
export class AuthModule {}
