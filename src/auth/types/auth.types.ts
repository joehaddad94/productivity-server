/** Internal: service returns this; controller sets cookie and returns only user. */
export interface AuthResult {
  user: { id: string; email: string; name: string | null; isAdmin: boolean };
  accessToken: string;
}

/** Result of register / login: no session until user clicks magic link. */
export interface MagicLinkMessageResult {
  message: string;
  magicLink?: string;
}
