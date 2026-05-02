import crypto from 'node:crypto';

// AES-256-GCM encryption for OAuth tokens at rest
// ENCRYPTION_KEY must be a 64-character hex string (32 bytes)

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex) throw new Error('ENCRYPTION_KEY env var not set');
  if (keyHex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be 64 hex chars (32 bytes). Generate with: openssl rand -hex 32');
  }
  return Buffer.from(keyHex, 'hex');
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: iv(12) + authTag(16) + ciphertext, all hex
  return Buffer.concat([iv, authTag, encrypted]).toString('hex');
}

export function decrypt(payload: string): string {
  const key = getKey();
  const data = Buffer.from(payload, 'hex');
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}
