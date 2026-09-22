import { timingSafeEqual } from 'node:crypto';

/** Loopback-only hosts accepted by default; remote access needs explicit config. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

/** Constant-time bearer comparison that never throws on shape mismatch. */
export function bearerMatches(header: string | undefined, token: string): boolean {
  if (!header || !header.startsWith('Bearer ')) return false;
  const presented = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(token);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

/** Host is loopback or the exact configured listen host. */
export function hostAllowed(host: string | undefined, listenHost: string): boolean {
  if (!host) return false;
  const name = host.split(':')[0]?.toLowerCase() ?? '';
  return LOOPBACK_HOSTS.has(name) || name === listenHost.toLowerCase();
}

/** Origin must be absent or loopback; browsers on other origins are rejected. */
export function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return LOOPBACK_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

/** Typed auth failure mapped to HTTP 401/403 by the server layer. */
export class AuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}
