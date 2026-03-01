import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTH_CONFIG } from '../config/auth-config';
import { RequestUser } from '../decorators/current-user.decorator';
import { UsersService } from '../../users/users.service';

interface JwtPayload {
  sub: string;
  email: string;
  jti: string;
}

function jwtFromCookieOrHeader(cookieName: string) {
  return (req: Request): string | null => {
    const fromCookie = req?.cookies?.[cookieName];
    if (fromCookie) return fromCookie;
    return ExtractJwt.fromAuthHeaderAsBearerToken()(req);
  };
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: jwtFromCookieOrHeader(AUTH_CONFIG.COOKIE_NAME),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>(AUTH_CONFIG.JWT_SECRET),
    });
  }

  async validate(payload: JwtPayload): Promise<RequestUser> {
    const session = await this.prisma.session.findUnique({
      where: { id: payload.jti },
    });
    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session invalid or expired');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      sessionId: payload.jti,
    };
  }
}
