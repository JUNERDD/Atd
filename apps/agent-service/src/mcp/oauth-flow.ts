import {
  errorMessage,
  type McpAuthCompleteResponse,
  type McpAuthStartResponse,
  type McpServerConfig,
} from '@ai/agent-contracts';
import type { McpNotices } from './callbacks.js';
import { McpError } from './errors.js';
import { idleState, signedIn, type SignInDeps } from './oauth-exchange.js';
import { isAbortLike, noSignIn, shownError, SignIns } from './oauth-signin.js';
import { oauthServerUrl } from './oauth-store.js';
import { classifyRedirect, reuseKey } from './servers.js';
import { LateWritebackProhibited } from './transactions.js';
import type { ResolveHttpUrl } from './types.js';

/**
 * Explicit auth operations (D6). Sign-in returns its URL at once (waiting for the browser holds
 * no credential lock); the loopback callback completes it by itself, and a pasted URL or code
 * does too (oauth-signin.ts). A completion checks the credential generation after the token
 * write and rolls a late writeback back; refresh is an explicit reconnect, never a silent replay.
 * Nothing here opens a browser.
 */

export interface AuthDeps extends SignInDeps {
  resolveHttpUrl: ResolveHttpUrl;
  notices: McpNotices;
  /** All txn identities ever issued for a server (revoke fans out). */
  identitiesFor: (serverId: string) => string[];
}

export class McpAuthManager {
  private readonly signIns: SignIns;

  constructor(private readonly deps: AuthDeps) {
    this.signIns = new SignIns(deps);
  }

  /**
   * Starts OAuth and answers the URL to open. A stored refresh token that still works signs in
   * without one. A failure is an `McpError`: its own, or `internal` (HTTP 500) for anything else,
   * as connecting answers it, since an authorization server that cannot be reached is not a bad
   * request. `_taskId` is accepted for the route; a server has one credential.
   */
  async start(
    serverId: string,
    signal?: AbortSignal,
    _taskId?: string,
  ): Promise<McpAuthStartResponse> {
    const { audit, states, notices } = this.deps;
    const record = this.deps.servers.record(serverId);
    assertOAuthHttp(record);
    signal?.throwIfAborted();
    // Nothing is sent before the launch is approved: an OAuth server may read env vars in its URL.
    await this.assertLaunch(record);
    const serverUrl = oauthServerUrl(this.deps.resolveHttpUrl(record));
    audit({ server: serverId, tool: 'mcp:auth-start', decision: 'request' });
    try {
      // An exchange that is finishing settles first: it may leave nothing to start.
      await this.signIns.exchangeSettled(serverId);
      const identity = reuseKey(record);
      const url = await this.deps.txns.runTokenOp(
        identity,
        (context) => this.signIns.begin(record, serverUrl, identity, context),
        { kind: 'exchange', ...(signal ? { signal } : {}) },
      );
      if (url === null) {
        await signedIn(this.deps, record, 'mcp:auth-start');
        return { serverId, authenticated: true, authorizationUrl: null, mode: 'oauth' };
      }
      states.set(serverId, 'auth_required', '');
      notices.authUrl(serverId, url);
      audit({ server: serverId, tool: 'mcp:auth-start', decision: 'url-issued' });
      const redirectKind = classifyRedirect(
        record.http?.auth.type === 'oauth' ? (record.http.auth.redirectUri ?? null) : null,
      );
      return {
        serverId,
        authenticated: false,
        authorizationUrl: url,
        mode: redirectKind === 'loopback' ? 'oauth' : 'manual-redirect',
      };
    } catch (error) {
      if (isAbortLike(error, signal)) {
        states.set(serverId, 'disconnected', '');
        throw error instanceof Error ? error : new Error('MCP auth start was cancelled.');
      }
      const shown = shownError(error, record);
      states.set(serverId, 'error', shown.message);
      this.deps.log.warn('An MCP sign-in could not start.', { serverId, reason: shown.name });
      // A `TypeError` (undici's `fetch failed`, the fixed `OAuth HTTP request failed`) would
      // otherwise answer as a 400.
      throw shown instanceof McpError ? shown : new McpError('internal', serverId, shown.message);
    }
  }

  /**
   * Completes OAuth from a pasted redirect URL or code, or reports that the callback already
   * did; a late writeback rolls back. `_taskId` is accepted for the route.
   */
  async complete(
    serverId: string,
    input: string,
    signal?: AbortSignal,
    _taskId?: string,
  ): Promise<McpAuthCompleteResponse> {
    const { audit, states } = this.deps;
    const record = this.deps.servers.record(serverId);
    assertOAuthHttp(record);
    signal?.throwIfAborted();
    await this.assertLaunch(record);
    audit({ server: serverId, tool: 'mcp:auth-complete', decision: 'request' });
    if (!this.signIns.active(serverId)) throw noSignIn(serverId);
    try {
      await this.signIns.complete(serverId, input, signal);
      return { serverId, authenticated: true };
    } catch (error) {
      if (error instanceof LateWritebackProhibited) throw error;
      if (isAbortLike(error, signal)) {
        states.set(serverId, 'auth_required', '');
        throw error instanceof Error ? error : new Error('MCP auth completion was cancelled.');
      }
      const shown = shownError(error, record);
      if (states.get(serverId) !== 'auth_required') states.set(serverId, 'error', shown.message);
      throw shown;
    }
  }

  /**
   * Explicit refresh: reconnects (the launch gate first, under the token lock, rediscovering the
   * catalog), which renews the token as the connection needs. Never replays tool calls.
   */
  async refresh(serverId: string, signal?: AbortSignal, taskId?: string): Promise<void> {
    const record = this.deps.servers.record(serverId);
    if (!record.http) throw new Error(`MCP server ${serverId} is not an HTTP server.`);
    this.deps.audit({ server: serverId, tool: 'mcp:refresh', decision: 'request' });
    await this.deps.connections.reconnect(serverId, signal, taskId);
    this.deps.audit({ server: serverId, tool: 'mcp:refresh', decision: 'ready' });
  }

  /**
   * Logs out: revokes in-flight and future token ops, cancels a sign-in in progress, deletes the
   * stored sign-in once any refresh has saved, and disconnects every connection of the server.
   * `_taskId` is accepted for the route; the credential belongs to the server.
   */
  async logout(serverId: string, _taskId?: string): Promise<void> {
    const { providers, log } = this.deps;
    const record = this.deps.servers.record(serverId);
    for (const identity of this.deps.identitiesFor(serverId)) this.deps.txns.revoke(identity);
    await this.signIns.discardServer(serverId);
    if (record.http?.auth.type === 'oauth') {
      await providers.settled();
      await providers
        .storeFor(record)
        .remove()
        .catch((error: unknown) => {
          log.warn('MCP token removal failed.', { serverId, error: errorMessage(error) });
        });
      providers.forget(serverId);
    }
    await this.deps.connections.disconnect(serverId);
    this.deps.states.set(serverId, idleState(record), '');
    this.deps.audit({ server: serverId, tool: 'mcp:logout', decision: 'logged-out' });
  }

  /** Ends every sign-in in progress and closes its callback server (the service is stopping). */
  closeAll(): Promise<void> {
    return this.signIns.closeAll();
  }

  private async assertLaunch(record: McpServerConfig): Promise<void> {
    await this.deps.launch.assertLaunch(record, await this.deps.connections.launchSpec(record));
  }
}

function assertOAuthHttp(record: McpServerConfig): void {
  if (!record.http || record.http.auth.type !== 'oauth') {
    throw new Error(`MCP server ${record.serverId} is not configured for OAuth over HTTP.`);
  }
}
