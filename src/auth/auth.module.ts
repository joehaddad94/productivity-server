import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AUTH_CONFIG } from './config/auth-config';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PASSWORD_HASHER } from './interfaces/password-hasher.interface';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { BcryptPasswordHasher } from './services/bcrypt-password-hasher.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    UsersModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
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
    JwtStrategy,
    JwtAuthGuard,
    BcryptPasswordHasher,
    {
      provide: PASSWORD_HASHER,
      useClass: BcryptPasswordHasher,
    },
  ],
  exports: [AuthService, PASSWORD_HASHER, JwtModule, JwtAuthGuard],
})
export class AuthModule {}
