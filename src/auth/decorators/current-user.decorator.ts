import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * User object attached to request after JWT validation.
 * sessionId is the session id (jti) for logout/revocation.
 */
export interface RequestUser {
  id: string;
  email: string;
  name: string | null;
  sessionId: string;
  isAdmin: boolean;
}

export const CurrentUser = createParamDecorator(
  (
    data: keyof RequestUser | undefined,
    ctx: ExecutionContext,
  ): RequestUser | string | boolean | null => {
    const request = ctx.switchToHttp().getRequest<{ user?: RequestUser }>();
    const user = request.user;
    if (!user) return null;
    if (data) return user[data] ?? null;
    return user;
  },
);
