import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AUTH_CONFIG } from './config/auth-config';
import { PASSWORD_HASHER } from './interfaces/password-hasher.interface';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { BcryptPasswordHasher } from './services/bcrypt-password-hasher.service';

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>(AUTH_CONFIG.JWT_SECRET),
        signOptions: {
          expiresIn: config.get(AUTH_CONFIG.JWT_EXPIRES_IN) ?? AUTH_CONFIG.JWT_EXPIRES_IN_DEFAULT,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    BcryptPasswordHasher,
    {
      provide: PASSWORD_HASHER,
      useClass: BcryptPasswordHasher,
    },
  ],
  exports: [AuthService, PASSWORD_HASHER, JwtModule],
})
export class AuthModule {}
