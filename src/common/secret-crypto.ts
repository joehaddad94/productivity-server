import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';

/**
 * Symmetric encryption for third-party secrets held at rest.
 *
 * Google and Microsoft refresh tokens are long-lived credentials for someone
 * else's calendar. They were stored in cleartext, so a database read handed
 * over ongoing access to every connected account.
 *
 * AES-256-GCM, so the ciphertext is authenticated and tampering is detected
 * rather than silently decrypting to garbage.
 *
 * Values are tagged `enc:v1:` and decrypt() passes anything untagged straight
 * through. That is deliberate: rows written before this existed are plaintext,
 * and connections must keep working. Each one re-encrypts the next time its
 * token is refreshed or reconnected.
 */

const PREFIX = 'enc:v1:';
const logger = new Logger('SecretCrypto');
let warned = false;

/**
 * 32-byte key derived from TOKEN_ENCRYPTION_KEY.
 *
 * Returns null when unset, in which case values are stored as before. This
 * keeps local development and any deploy that has not set the variable
 * working, rather than failing to save a calendar connection at all.
 */
function getKey(): Buffer | null {
  const secret = process.env.TOKEN_ENCRYPTION_KEY;
  if (!secret) {
    if (!warned) {
      warned = true;
      logger.warn(
        'TOKEN_ENCRYPTION_KEY is not set — calendar OAuth tokens will be stored unencrypted',
      );
    }
    return null;
  }
  // Accept any passphrase length; SHA-256 gives the 32 bytes AES-256 needs.
  return createHash('sha256').update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const key = getKey();
  if (!key || !plain) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(stored: string): string;
export function decryptSecret(stored: string | null): string | null;
export function decryptSecret(stored: string | null): string | null {
  if (!stored || !stored.startsWith(PREFIX)) return stored; // legacy plaintext
  const key = getKey();
  if (!key) {
    // Encrypted value with no key available: better to fail the call than to
    // hand a caller ciphertext it would send to Google as a bearer token.
    throw new Error(
      'TOKEN_ENCRYPTION_KEY is required to read an encrypted token',
    );
  }
  const [ivB64, tagB64, dataB64] = stored.slice(PREFIX.length).split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted value');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
