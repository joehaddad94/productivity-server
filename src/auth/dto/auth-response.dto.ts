/**
 * Response shape for login and register.
 * Exposes only safe user fields and the access token (no password hash, etc.).
 */
export class AuthResponseDto {
  user: {
    id: string;
    email: string;
    name: string | null;
  };
  accessToken: string;
}
