// PR #39 — Sprint 6.5: SSRF defense-in-depth.
//
// WHY THIS EXISTS:
// The landing's preview endpoint (PR #34) ships with a synchronous
// URL validator at lib/landing/url-validator.ts that blocks RFC
// 1918 ranges, loopback, link-local, IPv6 short-cuts, and the well-
// known cloud metadata hosts (169.254.169.254, metadata.google.
// internal, etc). That covers the obvious cases.
//
// What it DOESN'T cover: DNS rebinding. An attacker registers
// evil.com, points its A record at 127.0.0.1 (or 169.254.169.254),
// and submits "https://evil.com/" — the synchronous host check
// passes because "evil.com" isn't blocklisted, then our fetch()
// resolves DNS, hits localhost, and returns whatever your loopback
// service exposes.
//
// This module fixes that by RESOLVING THE HOSTNAME before the
// fetch fires and rejecting any A/AAAA record that points to a
// private range. We also strip credentials in the URL (user:pass@)
// because some HTTP libs forward them as Authorization headers.
//
// USAGE:
//   const safe = await assertSafeUrl(userSuppliedUrl);
//   if (!safe.valid) return 400(safe.reason);
//   await fetch(safe.url);
//
// We layer ON TOP OF lib/landing/url-validator (we still call its
// synchronous checks first) — that file is the cache-key and
// shape-validation layer; this file is the network layer.
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { validatePublicUrl } from '@/lib/landing/url-validator';

export interface SafeUrlResult {
  valid: boolean;
  reason?: string;
  /** Normalized, credential-free URL safe to pass to fetch(). */
  url?: string;
  /** First A/AAAA record we resolved — useful for debugging. */
  resolvedAddress?: string;
}

// IPv4 ranges that must never be reached. Mirrors the synchronous
// validator, but applied post-resolution so DNS rebinding can't
// sneak past.
function isPrivateIPv4(ip: string): boolean {
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)];
  if (a === 0) return true; // 0.0.0.0/8 (current network)
  if (a === 10) return true; // 10.0.0.0/8 RFC 1918
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + AWS metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 RFC 1918
  if (a === 192 && b === 168) return true; // 192.168/16 RFC 1918
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 IETF
  // CGNAT, TEST-NET, benchmark — not strictly private but not
  // routable to the public internet either.
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmark
  if (a === 192 && b === 0 && parseInt(m[3], 10) === 2) return true; // TEST-NET-1
  if (a === 198 && b === 51 && parseInt(m[3], 10) === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && parseInt(m[3], 10) === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast + reserved
  return false;
}

// IPv6 ranges. We don't enumerate every reserved block; we cover
// the ones an attacker would actually try.
function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1') return true; // loopback
  if (lower === '::') return true; // unspecified
  if (lower.startsWith('::ffff:')) {
    // IPv4-mapped — re-check the v4 part.
    return isPrivateIPv4(lower.slice(7));
  }
  // Link-local fe80::/10.
  if (/^fe[89ab][0-9a-f]?:/i.test(lower)) return true;
  // Unique-local fc00::/7 (covers fc00 + fd00).
  if (/^f[cd][0-9a-f]{2}:/i.test(lower)) return true;
  return false;
}

function stripCredentials(parsed: URL): URL {
  // Some HTTP libs (and Node fetch in some versions) forward
  // user:pass from URL into an Authorization header — making
  // SSRF + credential injection a one-shot for an attacker who
  // controls the URL.
  if (parsed.username || parsed.password) {
    parsed.username = '';
    parsed.password = '';
  }
  return parsed;
}

/**
 * Validates a user-supplied URL is safe to fetch. Performs:
 *   1. Synchronous shape + RFC 1918 / link-local / metadata checks
 *      (delegated to lib/landing/url-validator).
 *   2. Strips embedded credentials from the URL.
 *   3. Resolves the hostname and rejects if any A/AAAA record
 *      points to a private/loopback/link-local/multicast address
 *      (DNS rebinding mitigation).
 *
 * Returns a normalized URL string the caller should hand to
 * fetch(). Calling fetch() with the original `input` would skip
 * the credential strip.
 */
export async function assertSafeUrl(input: string): Promise<SafeUrlResult> {
  // Layer 1: synchronous shape + obvious-private checks.
  const sync = validatePublicUrl(input);
  if (!sync.valid) {
    return { valid: false, reason: sync.reason };
  }

  // Re-parse so we own the URL object and can strip credentials.
  let parsed: URL;
  try {
    const withProto = input.startsWith('http')
      ? input
      : `https://${input.trim()}`;
    parsed = new URL(withProto);
  } catch {
    return { valid: false, reason: 'Invalid URL' };
  }

  // Reject non-standard ports outright. Webhooks + landing
  // previews don't need ports 22, 25, 6379, 5432, etc.
  const port = parsed.port;
  if (port && port !== '80' && port !== '443') {
    return {
      valid: false,
      reason: `Port ${port} is not allowed (only 80 / 443).`,
    };
  }

  parsed = stripCredentials(parsed);

  const host = parsed.hostname.replace(/^\[|\]$/g, '');

  // Layer 2: hostname might already be a literal IP — sync
  // validator catches IPv4 but we defend explicitly here too.
  if (isIP(host)) {
    if (isPrivateIPv4(host) || isPrivateIPv6(host)) {
      return {
        valid: false,
        reason: 'IP address resolves to a private/internal range.',
      };
    }
    return { valid: true, url: parsed.toString(), resolvedAddress: host };
  }

  // Layer 3: DNS resolution. Reject every record that points
  // anywhere private. We use { all: true } to catch the case
  // where one A record is public and another is 127.0.0.1.
  let records: { address: string; family: number }[];
  try {
    records = await lookup(host, { all: true });
  } catch {
    return {
      valid: false,
      reason: `Could not resolve ${host}. Check the domain.`,
    };
  }

  if (records.length === 0) {
    return { valid: false, reason: `${host} has no A/AAAA records.` };
  }

  for (const r of records) {
    const isPrivate =
      r.family === 4 ? isPrivateIPv4(r.address) : isPrivateIPv6(r.address);
    if (isPrivate) {
      return {
        valid: false,
        reason: `${host} resolves to a private/internal address (${r.address}). Refusing to fetch.`,
      };
    }
  }

  return {
    valid: true,
    url: parsed.toString(),
    resolvedAddress: records[0].address,
  };
}
