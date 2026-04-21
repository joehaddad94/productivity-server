import { ApiProperty } from '@nestjs/swagger';

/**
 * Response shape for login, register, and magic-link verify.
 * JWT is set in HttpOnly cookie (accessToken); body returns only user.
 */
export class AuthResponseDto {
  @ApiProperty({ description: 'Authenticated user (safe fields only)' })
  user: {
    id: string;
    email: string;
    name: string | null;
    isAdmin: boolean;
  };
}
