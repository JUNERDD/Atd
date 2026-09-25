import {
  AgentClientError,
  AgentHttpClient,
  exchangeWebPairing,
  type AgentClientOptions,
} from '@ai/agent-client';

const STORAGE_KEY = 'ai.web.session';

interface StoredSession {
  token: string;
  serviceId: string;
  expiresAt: string;
}

export type SessionResult =
  | { kind: 'ready'; options: AgentClientOptions; serviceId: string }
  /** No usable session: this browser was never paired, or the pairing link or session expired. */
  | { kind: 'pair'; reason: 'none' | 'expired' }
  /** The service did not answer; the page offers a retry. */
  | { kind: 'offline'; detail: string };

function readStored(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === 'object' &&
      value !== null &&
      'token' in value &&
      typeof value.token === 'string' &&
      'serviceId' in value &&
      typeof value.serviceId === 'string' &&
      'expiresAt' in value &&
      typeof value.expiresAt === 'string'
    )
      return { token: value.token, serviceId: value.serviceId, expiresAt: value.expiresAt };
  } catch {
    // Blocked or corrupt storage reads as no session.
  }
  return null;
}

function store(session: StoredSession | null) {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Without storage the session lasts for this page only.
  }
}

/** Takes the one-time code out of `#pair=<code>` and removes it from the address bar. */
function takePairingCode(): string | null {
  const match = /^#pair=([A-Za-z0-9_-]{32,128})$/.exec(window.location.hash);
  if (!match) return null;
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  return match[1] ?? null;
}

/**
 * On the dev server of `pnpm dev`, a one-time code the server mints with the local owner token,
 * so opening the dev origin signs in without a link. Null elsewhere or while no service runs.
 */
async function devPairingCode(): Promise<string | null> {
  if (!import.meta.env.DEV) return null;
  try {
    const response = await fetch('/__ai/dev-pair', { method: 'POST' });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const code: unknown = typeof body === 'object' && body ? Reflect.get(body, 'code') : null;
    return typeof code === 'string' ? code : null;
  } catch {
    return null;
  }
}

/**
 * Signs this page in to the agent service it was served from (or that the dev server proxies).
 * A pairing link from the desktop app or `agent-service web` is exchanged for a session token
 * kept in `localStorage`; later visits reuse it until it expires or is revoked.
 */
export async function establishSession(): Promise<SessionResult> {
  const result = await signIn(takePairingCode());
  if (result.kind !== 'pair') return result;
  // Nothing usable yet: on the dev server the page can pair itself.
  const code = await devPairingCode();
  return code ? signIn(code) : result;
}

async function signIn(code: string | null): Promise<SessionResult> {
  const baseUrl = window.location.origin;
  if (code) {
    try {
      store(await exchangeWebPairing(baseUrl, code));
    } catch {
      store(null);
      return { kind: 'pair', reason: 'expired' };
    }
  }
  const session = readStored();
  if (!session || session.expiresAt <= new Date().toISOString()) {
    store(null);
    return { kind: 'pair', reason: session ? 'expired' : 'none' };
  }
  const options = { baseUrl, token: session.token };
  try {
    const status = await new AgentHttpClient(options).status();
    // A different service on this origin (a new data directory) needs its own pairing.
    if (status.service.serviceId !== session.serviceId) {
      store(null);
      return { kind: 'pair', reason: 'expired' };
    }
    return { kind: 'ready', options, serviceId: session.serviceId };
  } catch (error) {
    if (error instanceof AgentClientError && (error.status === 401 || error.status === 403)) {
      store(null);
      return { kind: 'pair', reason: 'expired' };
    }
    return {
      kind: 'offline',
      detail: error instanceof Error ? error.message : 'The agent service is unreachable.',
    };
  }
}

/** Forgets this browser's session (sign out, or the service rejected it). */
export function forgetSession() {
  store(null);
}
