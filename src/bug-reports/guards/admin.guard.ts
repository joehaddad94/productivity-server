import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { RequestUser } from '../../auth/decorators/current-user.decorator';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user?: RequestUser }>();
    const user = req.user;
    if (!user?.isAdmin) {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}
