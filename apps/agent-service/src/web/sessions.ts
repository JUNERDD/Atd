import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from '@ai/agent-contracts';
import { Type, type Static } from 'typebox';
import { atomicWrite } from '../config.js';

const PAIRING_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Codes waiting to be exchanged; older ones are dropped first. */
const MAX_PAIRINGS = 20;
const MAX_SESSIONS = 50;

const SessionFileSchema = Type.Object(
  {
    version: Type.Literal(1),
    sessions: Type.Array(
      Type.Object(
        {
          /** SHA-256 of the token, hex; the token itself is never stored. */
          hash: Type.String({ minLength: 64, maxLength: 64 }),
          createdAt: Type.String(),
          expiresAt: Type.String(),
        },
        { additionalProperties: false },
      ),
      { maxItems: MAX_SESSIONS },
    ),
  },
  { additionalProperties: false },
);
type StoredSession = Static<typeof SessionFileSchema>['sessions'][number];

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Browser sessions. The owner (a client holding the service token) mints short-lived one-time
 * pairing codes; a browser exchanges one for a session token. Sessions persist hashed in
 * `auth/web-sessions.json`, so a service restart keeps browsers signed in, and expire after 30
 * days. Pairing codes live in memory only: a restart voids codes nobody has used yet.
 */
export class WebSessions {
  private readonly pairings = new Map<string, number>();
  private chain: Promise<void> = Promise.resolve();

  private constructor(
    private readonly file: string,
    private sessions: StoredSession[],
  ) {}

  static async load(root: string): Promise<WebSessions> {
    const file = path.join(root, 'auth', 'web-sessions.json');
    try {
      const stored = parse(SessionFileSchema, JSON.parse(await readFile(file, 'utf8')));
      return new WebSessions(file, stored.sessions);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return new WebSessions(file, []);
      throw error;
    }
  }

  pair(): { code: string; expiresAt: string } {
    const now = Date.now();
    for (const [code, expires] of this.pairings) if (expires <= now) this.pairings.delete(code);
    while (this.pairings.size >= MAX_PAIRINGS) {
      const oldest = this.pairings.keys().next().value;
      if (oldest === undefined) break;
      this.pairings.delete(oldest);
    }
    const code = randomBytes(32).toString('base64url');
    const expires = now + PAIRING_TTL_MS;
    this.pairings.set(code, expires);
    return { code, expiresAt: new Date(expires).toISOString() };
  }

  /** Consumes a pairing code; null when it is unknown, used or expired. */
  async exchange(code: string): Promise<{ token: string; expiresAt: string } | null> {
    const expires = this.pairings.get(code);
    this.pairings.delete(code);
    if (expires === undefined || expires <= Date.now()) return null;
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const session: StoredSession = {
      hash: digest(token).toString('hex'),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    };
    await this.write((sessions) => [...sessions.slice(-(MAX_SESSIONS - 1)), session]);
    return { token, expiresAt: session.expiresAt };
  }

  /** Constant-time match against every live session. */
  verify(token: string): boolean {
    const presented = digest(token);
    const now = new Date().toISOString();
    let match = false;
    for (const session of this.sessions) {
      if (session.expiresAt <= now) continue;
      if (timingSafeEqual(presented, Buffer.from(session.hash, 'hex'))) match = true;
    }
    return match;
  }

  /** Ends the session behind `token` (sign out); unknown tokens are ignored. */
  async revoke(token: string): Promise<void> {
    const hash = digest(token).toString('hex');
    await this.write((sessions) => sessions.filter((session) => session.hash !== hash));
  }

  private write(change: (sessions: StoredSession[]) => StoredSession[]): Promise<void> {
    const pending = this.chain.then(async () => {
      const now = new Date().toISOString();
      const next = change(this.sessions.filter((session) => session.expiresAt > now));
      await atomicWrite(this.file, { version: 1, sessions: next }, 0o600);
      this.sessions = next;
    });
    this.chain = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }
}
