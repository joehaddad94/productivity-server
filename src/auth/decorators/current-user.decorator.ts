import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * User object attached to request after JWT validation.
 * Matches the safe user shape returned by auth endpoints.
 */
export interface RequestUser {
  id: string;
  email: string;
  name: string | null;
}

export const CurrentUser = createParamDecorator(
  (data: keyof RequestUser | undefined, ctx: ExecutionContext): RequestUser | string | null => {
    const request = ctx.switchToHttp().getRequest<{ user?: RequestUser }>();
    const user = request.user;
    if (!user) return null;
    if (data) return user[data] ?? null;
    return user;
  },
);
