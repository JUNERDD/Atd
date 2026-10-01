import type { McpServerConfig } from '@ai/agent-contracts';
import {
  authorizeMcp,
  type McpOAuthProvider,
  type OAuthCallbackServer,
} from '@earendil-works/pi-mcp/oauth';
import type { Logger } from '../logging.js';
import { McpError, type ServerResolver } from './errors.js';
import type { LaunchGate } from './launch-approvals.js';
import type { McpConnectionStates } from './lifecycle.js';
import { checkIssuer, type AuthorizationInput } from './oauth-callback.js';
import type { OAuthProviders } from './oauth-provider.js';
import type { KeychainOAuthStore } from './oauth-store.js';
import { reuseKey } from './servers.js';
import { LateWritebackProhibited, type CredentialTransactions } from './transactions.js';
import type { McpConnectionControl } from './types.js';

/**
 * A sign-in in progress and the step that ends it: the authorization code becomes stored tokens
 * under the credential lock, a revoke that landed meanwhile rolls them back, and every connection
 * moves to the new credentials. oauth-signin.ts keeps the sign-ins and decides when this runs.
 */

export interface SignInDeps {
  servers: ServerResolver;
  launch: LaunchGate;
  states: McpConnectionStates;
  txns: CredentialTransactions;
  connections: McpConnectionControl;
  providers: OAuthProviders;
  audit: (entry: Record<string, unknown>) => void;
  log: Logger;
}

export interface PendingSignIn {
  readonly serverId: string;
  /** The record it started for: error text that quotes its URL is shown as configured. */
  readonly record: McpServerConfig;
  /** `reuseKey` of the record it started for: the credential lock and revokes it lives under. */
  readonly identity: string;
  /** The identity's generation at the start; a revoke since then rolls the sign-in back. */
  readonly generation: number;
  readonly serverUrl: string;
  /** The `state` parameter of the authorization URL. */
  readonly state: string;
  readonly provider: McpOAuthProvider;
  readonly store: KeychainOAuthStore;
  readonly callback: OAuthCallbackServer | null;
  /** The redirect is elsewhere (https): only a pasted URL completes the sign-in. */
  readonly manual: boolean;
  readonly authorizationUrl: string;
  timer: NodeJS.Timeout;
  /** `done` stays until expiry, so a paste after the callback answers "signed in". */
  phase: 'waiting' | 'finishing' | 'done';
  finishing?: Promise<void>;
  closing?: Promise<void>;
}

/** Exchanges the authorization code for tokens, stores them and moves the server to them. */
export async function exchangeSignIn(
  deps: SignInDeps,
  pending: PendingSignIn,
  { code, iss }: AuthorizationInput,
  signal?: AbortSignal,
): Promise<void> {
  const { txns, audit, states, providers, launch, connections } = deps;
  const { serverId } = pending;
  // The exchange sends the record's headers, so it must still be the record the sign-in started
  // for, and approved, whichever way the answer arrived.
  const record = deps.servers.record(serverId);
  if (reuseKey(record) !== pending.identity) {
    throw new McpError('conflict', serverId, 'The server changed during sign-in.');
  }
  await launch.assertLaunch(record, await connections.launchSpec(record));
  await checkIssuer(pending.provider, serverId, iss);
  await txns.runTokenOp(
    pending.identity,
    async (context) => {
      const flow = providers.flowFetch(record, pending.serverUrl, context.signal);
      await authorizeMcp(pending.provider, {
        serverUrl: pending.serverUrl,
        authorizationCode: code,
        fetch: flow.fetch,
      });
      flow.check();
      // A retired store drops writes silently, and that must not read as a sign-in.
      if (!(await pending.store.load())?.tokens) {
        throw new McpError('conflict', serverId, 'The sign-in was not saved.');
      }
    },
    { kind: 'exchange', ...(signal ? { signal } : {}) },
  );
  try {
    // The generation check comes after the write: a revoke that landed mid-flight rolls the
    // tokens back out of the keychain.
    await txns.commitChecked(pending.identity, pending.generation, async () => undefined);
  } catch (error) {
    if (error instanceof LateWritebackProhibited) {
      await pending.store.remove().catch(() => undefined);
      states.set(serverId, 'disconnected', '');
      audit({ server: serverId, tool: 'mcp:auth-complete', decision: 'revoked-rollback' });
    }
    throw error;
  }
  await closeCallback(pending);
  await signedIn(deps, record, 'mcp:auth-complete');
}

/**
 * The credentials changed: every connection needs the new ones. The old store is retired first,
 * so a connection that opens meanwhile reads the new state, and the old ones cannot write back.
 */
export async function signedIn(
  deps: SignInDeps,
  record: McpServerConfig,
  tool: 'mcp:auth-start' | 'mcp:auth-complete',
): Promise<void> {
  deps.providers.forget(record.serverId);
  await deps.connections.disconnect(record.serverId);
  deps.states.set(record.serverId, idleState(record), '');
  deps.audit({ server: record.serverId, tool, decision: 'authenticated' });
}

/** Closes the sign-in's callback server once, however many callers ask. */
export function closeCallback(pending: PendingSignIn): Promise<void> {
  pending.closing ??= pending.callback?.close().catch(() => undefined) ?? Promise.resolve();
  return pending.closing;
}

/** A disabled server stays disabled when its credentials change. */
export function idleState(record: McpServerConfig): 'disabled' | 'disconnected' {
  return record.disabled ? 'disabled' : 'disconnected';
}
