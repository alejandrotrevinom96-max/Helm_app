// PR #34 — Sprint 6.2: anti-SSRF URL validation for the public
// preview endpoint.
//
// Anyone can POST a URL to /api/public/preview-bible (no auth);
// without filtering, an attacker could probe internal services by
// asking us to fetch http://localhost:8080/, http://10.0.0.x/,
// http://metadata.google.internal/, etc. We reject those before
// the fetch happens.
//
// We also normalize URLs (lowercase, https default, no trailing
// slash) so the cache key is consistent across "https://X.com",
// "https://x.com/", and "x.com".
import { createHash } from 'crypto';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  // GCP / AWS / Azure metadata endpoints — classic SSRF targets.
  'metadata.google.internal',
  'metadata.aws.internal',
  '169.254.169.254',
  // Reserved / pseudo-domains used internally.
  'internal',
  'private',
]);

const BLOCKED_TLDS = ['.test', '.local', '.invalid', '.localhost'];

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export function normalizeUrl(input: string): string {
  let normalized = input.trim().toLowerCase();
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = `https://${normalized}`;
  }
  // Drop trailing slash on root path so "site.com/" and "site.com"
  // hit the same cache row.
  return normalized.replace(/\/$/, '');
}

export function hashUrl(url: string): string {
  return createHash('sha256')
    .update(normalizeUrl(url))
    .digest('hex')
    .slice(0, 32);
}

// Reject 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 (RFC 1918 private),
// 127.0.0.0/8 (loopback), 169.254.0.0/16 (link-local incl. cloud
// metadata), and 0.0.0.0/8 (current network).
function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

export function validatePublicUrl(input: string): ValidationResult {
  if (!input || input.trim().length === 0) {
    return { valid: false, reason: 'URL is required' };
  }

  let parsed: URL;
  try {
    parsed = new URL(normalizeUrl(input));
  } catch {
    return { valid: false, reason: 'Invalid URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: 'Only HTTP/HTTPS URLs are allowed' };
  }

  const host = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(host)) {
    return { valid: false, reason: 'This hostname is not allowed' };
  }
  if (BLOCKED_TLDS.some((tld) => host.endsWith(tld))) {
    return { valid: false, reason: 'This TLD is not allowed' };
  }
  if (isPrivateIPv4(host)) {
    return { valid: false, reason: 'Private IP addresses are not allowed' };
  }
  // IPv6 link-local / loopback short-circuit. Skip the full RFC 4291
  // table; the simple cases below cover what an attacker would try.
  if (host.startsWith('[fe80:') || host === '[::1]' || host === '[::]') {
    return { valid: false, reason: 'Private IPv6 addresses are not allowed' };
  }

  // Bare hostnames without a TLD ("foo", "bar") would resolve to
  // search-domain entries which often map to internal hosts.
  if (!host.includes('.') && !/^\d+(\.\d+){3}$/.test(host)) {
    return { valid: false, reason: 'URL must include a public domain' };
  }

  return { valid: true };
}
