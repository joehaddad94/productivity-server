import { ApiProperty } from '@nestjs/swagger';

/**
 * Response shape for login and register.
 * Exposes only safe user fields and the access token (no password hash, etc.).
 */
export class AuthResponseDto {
  @ApiProperty({ description: 'Authenticated user (safe fields only)' })
  user: {
    id: string;
    email: string;
    name: string | null;
  };

  @ApiProperty({ description: 'JWT access token for Authorization header (present after login)' })
  accessToken?: string;
}
