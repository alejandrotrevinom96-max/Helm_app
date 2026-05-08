// PR #29 — Sprint 5.1: Auto-posting Meta foundation.
//
// AES-256-GCM symmetric encryption for OAuth tokens at rest. Used by
// the Meta integration to wrap the Page Access Token before it goes
// into meta_integrations.facebook_page_access_token, and unwrap it
// inside the publishing engine.
//
// Why GCM specifically:
//   - Authenticated encryption — we get tamper detection for free.
//   - The 16-byte authTag travels with the ciphertext so a corrupted
//     row throws on decrypt instead of silently producing garbage.
//
// Key derivation:
//   - We sha256() a long secret string (TOKEN_ENCRYPTION_KEY) into a
//     32-byte key. Lets the operator set any-length passphrase.
//   - Falls back to NEXTAUTH_SECRET so a freshly-deployed environment
//     can still encrypt — but operations should override with a
//     dedicated key from `openssl rand -hex 32`.
//
// Format on disk: `<ivHex>:<authTagHex>:<cipherHex>` — three colon-
// separated hex blobs. Easy to debug without decoding.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 16; // GCM standard
const FALLBACK_DEV_KEY = 'fallback-dev-only-do-not-use-in-prod';

// PR #39 Sprint 6.5: pre-PR-39 we warned and continued when
// TOKEN_ENCRYPTION_KEY was missing in production. That's a
// security smoke alarm at best — anyone who got their hands on
// the codebase could decrypt OAuth tokens by hashing the literal
// fallback string. Now we hard-fail in prod. Migrations and
// startup paths that legitimately need a crypto handle MUST set
// the env var (already documented in SETUP.md).
function getKey(): Buffer {
  const secret =
    process.env.TOKEN_ENCRYPTION_KEY ??
    process.env.NEXTAUTH_SECRET ??
    FALLBACK_DEV_KEY;
  if (secret === FALLBACK_DEV_KEY) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[token-encryption] TOKEN_ENCRYPTION_KEY (or NEXTAUTH_SECRET) MUST be set in production. Refusing to encrypt with the public fallback key. Generate one with `openssl rand -hex 32` and set it on Vercel.'
      );
    }
    // Dev-mode signal: still loud, but doesn't brick local boots.
    if (process.env.NODE_ENV !== 'test') {
      console.warn(
        '[token-encryption] Using FALLBACK_DEV_KEY. Set TOKEN_ENCRYPTION_KEY for any data you intend to keep across restarts.'
      );
    }
  }
  return createHash('sha256').update(secret).digest();
}

export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export function decryptToken(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format');
  }
  const [ivHex, authTagHex, cipherHex] = parts;
  const key = getKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
