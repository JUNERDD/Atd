import { errorMessage, type McpServerConfig } from '@ai/agent-contracts';
import {
  authorizeMcp,
  McpOAuthAuthorizationRequiredError,
  McpOAuthProvider,
  type OAuthCallback,
  type OAuthChallenge,
} from '@earendil-works/pi-mcp/oauth';
import { MCP_OAUTH_CLIENT_NAME, MCP_OAUTH_FLOW_TTL_MS } from './constants.js';
import { McpError } from './errors.js';
import { withConfiguredUrl } from './launch-resolve.js';
import {
  IssuerRequiredError,
  openRedirect,
  parseAuthorizationInput,
  type AuthorizationInput,
} from './oauth-callback.js';
import {
  closeCallback,
  exchangeSignIn,
  type PendingSignIn,
  type SignInDeps,
} from './oauth-exchange.js';
import { configuredScope, mergeScopes } from './oauth-provider.js';
import { LateWritebackProhibited, TxnAborted, TxnRevoked } from './transactions.js';
import type { OAuthConnectionAuth } from './types.js';

/**
 * The sign-ins in progress: one per server, from the authorization URL handed out until the tokens
 * are stored, the sign-in fails, or it expires. The loopback callback and a pasted URL or code both
 * finish it, whichever comes first (the second joins the first). Only the token exchange takes the
 * credential lock (oauth-exchange.ts); waiting for the browser holds none.
 */

export class SignIns {
  private readonly pending = new Map<string, PendingSignIn>();

  constructor(private readonly deps: SignInDeps) {}

  /** Whether the server has a sign-in to complete (a finished one counts until it expires). */
  active(serverId: string): boolean {
    return this.pending.has(serverId);
  }

  /** Resolves once an exchange in flight has ended, successfully or not. */
  async exchangeSettled(serverId: string): Promise<void> {
    await this.pending.get(serverId)?.finishing?.catch(() => undefined);
  }

  /**
   * Starts a sign-in with the credential lock held: answers the URL to open, or null when the
   * stored refresh token signed in without one. The same URL comes back while an unexpired
   * sign-in of the same record waits.
   */
  async begin(
    record: McpServerConfig,
    serverUrl: string,
    identity: string,
    context: { signal: AbortSignal; generation: number },
  ): Promise<string | null> {
    const { providers } = this.deps;
    const existing = this.pending.get(record.serverId);
    if (
      existing?.phase !== 'done' &&
      existing?.serverUrl === serverUrl &&
      existing.identity === identity
    ) {
      return existing.authorizationUrl;
    }
    if (existing) await this.discard(existing);
    // What the server asked for when it turned a connection down: its metadata URL, more scope.
    const challenge = providers.challengeFor(record.serverId, serverUrl);
    // A stored refresh token that still works signs in without a URL, by the refresh the
    // connections share (a rotating token is spent once), and the stored sign-in stays as it is
    // until the browser is needed. A refresh keeps the granted scope: more scope needs the browser.
    const auth = providers.authFor(record, serverUrl);
    const renewed = challenge?.error !== 'insufficient_scope' && (await renews(auth));
    // A revoke or logout that landed meanwhile must not leave a sign-in behind.
    context.signal.throwIfAborted();
    if (renewed) return null;
    await auth.settled(); // nothing may still be saving a refresh when the state is rewritten
    return this.interactive(record, serverUrl, identity, context, challenge);
  }

  /** The browser leg: a new sign-in whose redirect this service listens for. */
  private async interactive(
    record: McpServerConfig,
    serverUrl: string,
    identity: string,
    context: { signal: AbortSignal; generation: number },
    challenge: OAuthChallenge | undefined,
  ): Promise<string> {
    const { providers } = this.deps;
    const store = providers.storeFor(record);
    const { redirectUrl, server } = await openRedirect(record, serverUrl, store);
    let adopted = false;
    try {
      const scope = configuredScope(record);
      let redirect: URL | undefined;
      const provider = new McpOAuthProvider({
        serverUrl,
        redirectUrl,
        clientMetadata: { client_name: MCP_OAUTH_CLIENT_NAME, ...(scope ? { scope } : {}) },
        store,
        onRedirect: (url) => {
          redirect = url;
        },
      });
      const flow = providers.flowFetch(record, serverUrl, context.signal);
      await authorizeMcp(provider, {
        serverUrl,
        scope: mergeScopes(scope, challenge?.scope),
        resourceMetadataUrl: challenge?.resourceMetadataUrl,
        skipRefresh: true, // the renewal was tried, or there was nothing to renew
        fetch: flow.fetch,
      });
      flow.check();
      if (!redirect) throw new Error('The authorization server gave no authorization URL.');
      const state = await provider.state();
      context.signal.throwIfAborted();
      const pending: PendingSignIn = {
        serverId: record.serverId,
        record,
        identity,
        generation: context.generation,
        serverUrl,
        state,
        provider,
        store,
        callback: server,
        manual: server === null,
        authorizationUrl: redirect.toString(),
        timer: setTimeout(() => this.expire(pending), MCP_OAUTH_FLOW_TTL_MS),
        phase: 'waiting',
      };
      pending.timer.unref();
      this.pending.set(record.serverId, pending);
      adopted = true;
      // Listening before the URL goes out, so the redirect cannot arrive unheard.
      void server?.waitForCallback(pending.state).then(
        (callback) => this.finishFromCallback(pending, callback),
        (error: unknown) => this.callbackFailed(pending, error),
      );
      return pending.authorizationUrl;
    } finally {
      if (!adopted) await server?.close().catch(() => undefined);
    }
  }

  /** Completes the server's sign-in from a pasted answer, or joins the callback completing it. */
  async complete(serverId: string, input: string, signal?: AbortSignal): Promise<void> {
    const pending = this.pending.get(serverId);
    if (!pending) throw noSignIn(serverId);
    if (pending.phase !== 'waiting') return pending.finishing; // finished or finishing already
    await this.finish(
      pending,
      parseAuthorizationInput(input, pending.state, pending.manual),
      signal,
    );
  }

  async discardServer(serverId: string): Promise<void> {
    const pending = this.pending.get(serverId);
    if (pending) await this.discard(pending);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.pending.values()].map((pending) => this.discard(pending)));
  }

  /** A failure ends the sign-in, except one that only asks for the full redirect URL. */
  private finish(
    pending: PendingSignIn,
    input: AuthorizationInput,
    signal?: AbortSignal,
  ): Promise<void> {
    if (pending.finishing) return pending.finishing;
    pending.phase = 'finishing';
    const run = exchangeSignIn(this.deps, pending, input, signal).then(
      () => {
        pending.phase = 'done';
      },
      async (error: unknown) => {
        pending.finishing = undefined;
        if (error instanceof IssuerRequiredError) pending.phase = 'waiting';
        else await this.discard(pending);
        throw error;
      },
    );
    pending.finishing = run;
    return run;
  }

  private async finishFromCallback(pending: PendingSignIn, callback: OAuthCallback): Promise<void> {
    try {
      const iss = callback.iss;
      await this.finish(pending, { code: callback.code, ...(iss ? { iss } : {}) });
    } catch (error) {
      // A revoke or logout that cancelled the exchange has put the server where it belongs.
      const cancelled =
        error instanceof LateWritebackProhibited ||
        error instanceof TxnRevoked ||
        isAbortLike(error);
      if (!cancelled) this.report(pending, error);
    }
  }

  /** The redirect brought an error or the wait timed out (closing the server ends the wait too). */
  private async callbackFailed(pending: PendingSignIn, error: unknown): Promise<void> {
    if (this.pending.get(pending.serverId) !== pending || pending.phase !== 'waiting') return;
    await this.discard(pending);
    this.report(pending, error);
  }

  /** Nobody awaits a callback's outcome, so a failure shows on the server's status row. */
  private report(pending: PendingSignIn, error: unknown): void {
    const { states, log } = this.deps;
    log.warn('An MCP sign-in did not finish.', {
      serverId: pending.serverId,
      reason: error instanceof Error ? error.name : 'unknown',
    });
    const state = states.get(pending.serverId) === 'auth_required' ? 'auth_required' : 'error';
    states.set(pending.serverId, state, shownError(error, pending.record).message);
  }

  private expire(pending: PendingSignIn): void {
    if (this.pending.get(pending.serverId) !== pending) return;
    if (pending.phase === 'finishing') {
      pending.timer = setTimeout(() => this.expire(pending), 1_000).unref(); // let the exchange end
      return;
    }
    const { states, log } = this.deps;
    log.info('An MCP sign-in expired before it was completed.', { serverId: pending.serverId });
    if (pending.phase === 'waiting' && states.get(pending.serverId) === 'auth_required') {
      states.set(pending.serverId, 'auth_required', 'The sign-in expired; start it again.');
    }
    void this.discard(pending);
  }

  private async discard(pending: PendingSignIn): Promise<void> {
    clearTimeout(pending.timer);
    if (this.pending.get(pending.serverId) === pending) this.pending.delete(pending.serverId);
    await closeCallback(pending);
  }
}

/** Whether the connection auth signed in again; false when only the browser helps. */
async function renews(auth: OAuthConnectionAuth): Promise<boolean> {
  try {
    await auth.renew();
    return true;
  } catch (error) {
    // Anything else that stopped it (network, timeout) is reported, and the stored sign-in kept.
    if (error instanceof McpOAuthAuthorizationRequiredError) return false;
    throw error;
  }
}

/** Invocation aborts, txn cancels and lifecycle aborts all end the op. */
export function isAbortLike(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted || error instanceof TxnAborted) return true;
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TxnAborted');
}

export function noSignIn(serverId: string): McpError {
  return new McpError(
    'conflict',
    serverId,
    `No MCP sign-in is in progress for ${serverId}; start it again.`,
  );
}

/**
 * `error` for the status row, the response and the logs. Library errors quote the URL a flow used
 * (pi-mcp's protected-resource check does), with the values of its environment references filled
 * in, so the text shows the URL as configured. The text is replaced on the error itself: its
 * class, and the HTTP status that class maps to, stay.
 */
export function shownError(error: unknown, record: McpServerConfig): Error {
  if (!(error instanceof Error)) return new Error(errorMessage(error));
  for (const key of ['message', 'stack'] as const) {
    const text = error[key];
    const shown = text === undefined ? undefined : withConfiguredUrl(text, record);
    if (shown !== undefined && shown !== text) {
      Object.defineProperty(error, key, { value: shown, configurable: true, writable: true });
    }
  }
  return error;
}
