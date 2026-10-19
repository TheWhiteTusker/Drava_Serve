import { createHash, scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

// Passwords and PINs: scrypt from the Node standard library.
const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
export async function hashSecret(secret: string) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(secret, salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export async function verifySecret(secret: string, stored: string | null | undefined) {
  const [, salt, hash] = stored?.split('$') ?? [];
  if (!salt || !hash) return false;
  const actual = await scryptAsync(secret, Buffer.from(salt, 'base64'), 32);
  return timingSafeEqual(actual, Buffer.from(hash, 'base64'));
}

// ponytail: JWT_SECRET is optional for now. Without it, production signs sessions with a key derived
// from POSTGRES_URL (it holds the database password, so it is secret and the same on every instance);
// changing that password signs everyone out. Set JWT_SECRET to manage the key on its own.
let warned = false;
export function jwtSecret() {
  const s = process.env.JWT_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production' && process.env.POSTGRES_URL) {
    if (!warned) console.warn('JWT_SECRET is not set; signing sessions with a key derived from POSTGRES_URL');
    warned = true;
    return createHash('sha256').update(`fnb-jwt:${process.env.POSTGRES_URL}`).digest('base64url');
  }
  return 'dev-only-secret-change-me';
}

// Password-reset links are signed with their own key, so a reset token never works as a session
// token and a session token never resets a password.
export const resetSecret = () => `${jwtSecret()}:password-reset`;

// Ties a reset link to the password it replaces: once the password changes, the link stops working.
export const passwordStamp = (hash: string | null) => createHash('sha256').update(hash ?? '').digest('base64url').slice(0, 16);
