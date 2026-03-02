import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AUTH_CONFIG } from './config/auth-config';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './services/session.service';
import { MagicLinkService } from './services/magic-link.service';
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
  providers: [AuthService, SessionService, MagicLinkService, JwtStrategy, JwtAuthGuard],
  exports: [AuthService, JwtModule, JwtAuthGuard],
})
export class AuthModule {}
