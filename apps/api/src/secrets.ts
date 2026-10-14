import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
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
