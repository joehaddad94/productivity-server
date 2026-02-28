/**
 * Abstraction for password hashing (Dependency Inversion).
 * Auth depends on this interface; the concrete implementation can be bcrypt, argon2, etc.
 */
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');

export interface IPasswordHasher {
  hash(plainPassword: string): Promise<string>;
  compare(plainPassword: string, hashedPassword: string): Promise<boolean>;
}
