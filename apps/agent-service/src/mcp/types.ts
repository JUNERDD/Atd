import type { McpServerConfig, McpToolRef } from '@ai/agent-contracts';
import type { ToolAnnotations } from '@earendil-works/pi-coding-agent';
import type {
  AuthProvider,
  McpClient,
  McpTransport,
  ServerCapabilities,
} from '@earendil-works/pi-mcp';

/**
 * The shared contract of the MCP layer on `@earendil-works/pi-mcp` (D-mcp v2): the shapes the
 * connection, OAuth and facade modules hand each other. Types only; each declaration names the
 * module that implements it, and nothing here imports one of those modules.
 */

/**
 * What connecting one record would run or dial, before any env reference is filled in: the probed
 * executable plus the record's own arguments, env, working directory, URL and headers. Launch
 * approvals fingerprint exactly these fields (launch-fingerprint.ts) with the values
 * pi-mcp-adapter's server entry carried, so approvals stored before the migration still match.
 * Built by `McpConnections.launchSpec` from `toLaunchSpec` (servers.ts); bearer secrets never
 * enter it.
 */
export interface McpLaunchSpec {
  /** stdio: the executable the command resolves to now (`probeStdioRuntime`). */
  command?: string;
  /** stdio: the arguments as configured, env references unfilled. */
  args?: string[];
  /** stdio: the env values as configured, env references unfilled and `!!` escapes kept. */
  env?: Record<string, string>;
  /**
   * stdio: `false` for every record (`toLaunchSpec`): the process gets `MCP_INHERITED_ENV_KEYS`
   * from the service plus `env`, never the whole service environment.
   */
  inheritEnv?: boolean;
  /** stdio: the configured working directory; absent means the authority's cwd. */
  cwd?: string;
  /** HTTP: the URL as configured, env references unfilled. */
  url?: string;
  /** HTTP: the header values as configured, env references unfilled and `!!` escapes kept. */
  headers?: Record<string, string>;
}

/** How an HTTP launch authenticates. */
export type McpHttpCredential =
  | { type: 'none' }
  /** From `tokenEnv` or the keyring (`bearerSecrets`), sent as is: never filled in or run. */
  | { type: 'bearer'; token: string }
  /** Tokens come from the server's `OAuthConnectionAuth` (oauth-provider.ts). */
  | { type: 'oauth' };

/** A stdio launch after the app's resolution rules (launch-resolve.ts). */
export interface McpStdioLaunch {
  kind: 'stdio';
  /** The probed executable, used as is. */
  command: string;
  /** Env references filled in, then a leading `~` expanded; `!!` stays as written. */
  args: string[];
  /** Absolute; relative configured paths resolve against the authority's cwd; must be a directory. */
  cwd: string;
  /**
   * The whole child environment: the service's values of `MCP_INHERITED_ENV_KEYS`, then the
   * record's env with references filled in and a leading `!!` turned into `!`.
   */
  env: Record<string, string>;
}

/** An HTTP launch (Streamable HTTP or legacy HTTP+SSE) after the app's resolution rules. */
export interface McpHttpLaunch {
  kind: 'streamable-http' | 'sse';
  /** Env references filled in; a reference to an unset variable refuses the launch. */
  url: string;
  /** Env references filled in and a leading `!!` turned into `!`. */
  headers: Record<string, string>;
  credential: McpHttpCredential;
}

/** Exactly what one connect spawns or dials (launch-resolve.ts `resolveLaunch`). */
export type ResolvedLaunch = McpStdioLaunch | McpHttpLaunch;

/**
 * Builds the pi-mcp transport of one resolved launch (transports.ts `createTransport`). `auth` is
 * the server's shared OAuth connection auth, present exactly when the credential is `oauth`.
 * Tests inject a factory that returns in-memory transports (`@earendil-works/pi-mcp/testing`).
 */
export type McpTransportFactory = (
  launch: ResolvedLaunch,
  auth: OAuthConnectionAuth | undefined,
) => McpTransport;

/**
 * An HTTP record's URL with its env references filled in by the app's rules
 * (launch-resolve.ts `resolveHttpUrl`). Throws McpError `internal` naming the unset variables,
 * never their values, and for a URL that carries a user name or password once filled in. OAuth
 * state is keyed by this URL, so connections and sign-ins agree.
 */
export type ResolveHttpUrl = (record: McpServerConfig) => string;

/** Tool, resource and prompt counts of one live connection, as status rows show them. */
export interface McpCatalogCounts {
  tools: number;
  resources: number;
  prompts: number;
}

/**
 * Lists a freshly connected client's catalog sizes (catalog.ts `countCatalog`), each only when the
 * server advertises it: a tools failure fails the connect, a resources or prompts failure counts
 * zero, and authentication errors always propagate. Re-run on every `list_changed`.
 */
export type McpCatalogCounter = (
  client: McpClient,
  signal: AbortSignal | undefined,
) => Promise<McpCatalogCounts>;

/** One open physical connection of the pool (pool.ts), shared by every caller of its name. */
export interface McpLiveConnection {
  /** The logical server. */
  readonly serverId: string;
  /** `physicalName(record, taskId)`: the server id, or a per-task alias of an isolated record. */
  readonly physical: string;
  /** `reuseKey(record)` of the record it was opened for; another key never reuses it. */
  readonly reuseKey: string;
  /** What the server advertised at initialize. */
  readonly capabilities: ServerCapabilities;
  /** Counts from the connect, refreshed on `list_changed`. */
  counts(): McpCatalogCounts;
  /** False once the transport closed (dropped, idle-closed or closed on purpose). */
  isOpen(): boolean;
  /**
   * Runs one request on the client. The connection counts it as in flight and touches its last
   * use, so an idle close never takes a busy connection. Every facade request goes through here.
   */
  use<T>(request: (client: McpClient) => Promise<T>): Promise<T>;
}

/** A connection `McpConnections.ensure` found or opened, with the record it serves. */
export interface EnsuredConnection {
  record: McpServerConfig;
  physical: string;
  connection: McpLiveConnection;
}

/**
 * Connection lifecycle over the pool (connect.ts `ConnectionManager`). Every spawn or dial
 * passes the launch gate first; logical states (`McpStateSink`) follow each outcome; token-bearing
 * connects serialize on the record's credential identity (`CredentialTransactions`).
 */
export interface McpConnections {
  /**
   * The live connection for the record now: reused while it is open and opened for the same
   * `reuseKey`, else (re)connected. A server in `auth_required`, `closing` or disabled is refused
   * before anything is dialed, as today. A connect that a revoke, disable or removal overtakes
   * fails with McpError `conflict` (409) and leaves the row to that change, except that a row it
   * left `connecting` returns to `disconnected`; so do `connect` and `reconnect`.
   */
  ensure(serverId: string, signal?: AbortSignal, taskId?: string): Promise<EnsuredConnection>;
  /** Connects the base connection, or a task alias of an isolated record. */
  connect(serverId: string, signal?: AbortSignal, taskId?: string): Promise<void>;
  /**
   * Closes the base connection and every task alias; their in-flight requests fail. An id that is
   * not configured is McpError `not_found`, as today.
   */
  disconnect(serverId: string): Promise<void>;
  /**
   * `disconnect` for a server a change removed or disabled, run after the change committed
   * (authority.ts `apply`): it closes whatever is still open for the id, a connection that began
   * before the commit included, whether or not the record still resolves, and settles the row.
   */
  disconnectLeaving(serverId: string): Promise<void>;
  /**
   * Checks the launch, closes the named connection and connects again, rediscovering the catalog;
   * never replays a call. The reconnect route and OAuth refresh both come here.
   */
  reconnect(serverId: string, signal?: AbortSignal, taskId?: string): Promise<void>;
  /** What a connect of `record` would launch; launch approvals fingerprint exactly this. */
  launchSpec(record: McpServerConfig): Promise<McpLaunchSpec>;
  /**
   * Drops a connection whose server forgot its session (`McpSessionExpiredError`) without failing
   * the other requests on it; the next `ensure` opens a new one.
   */
  discard(connection: McpLiveConnection): Promise<void>;
  /**
   * Max counts over the server's open connections (base and aliases); what it last offered under
   * its present configuration while none is open, zeros if it never connected.
   */
  counts(serverId: string): McpCatalogCounts;
  /** Closes everything and waits for in-flight OAuth refreshes to save their tokens. */
  closeAll(): Promise<void>;
}

/** What the OAuth flow needs from the connections (oauth-flow.ts). */
export type McpConnectionControl = Pick<McpConnections, 'disconnect' | 'reconnect' | 'launchSpec'>;

/**
 * A pi-mcp `AuthProvider` for one OAuth server's connections (oauth-provider.ts): sends the stored
 * access token, refreshes it shortly before it expires or after a 401, and throws
 * `McpOAuthAuthorizationRequiredError` when only a new sign-in helps. It never registers a client
 * and never opens a browser; sign-in belongs to the user-started flow (oauth-flow.ts).
 */
export interface OAuthConnectionAuth extends AuthProvider {
  /** Resolves once no refresh is in flight, so a rotated refresh token is saved before close. */
  settled(): Promise<void>;
  /**
   * Renews the stored sign-in from its refresh token now, as the one refresh the connections share
   * (a sign-in start uses it before asking for the browser). Resolves once a fresh access token is
   * stored, or another request already replaced the old one; throws
   * `McpOAuthAuthorizationRequiredError` when only a new sign-in helps, else what stopped it.
   */
  renew(): Promise<void>;
}

/** OAuth credentials of the servers (oauth-provider.ts `OAuthProviders`). */
export interface McpCredentialAuth {
  /**
   * The connection auth every connection of the server shares (base and task aliases), so
   * concurrent 401s share one refresh. `serverUrl` is `ResolveHttpUrl`'s result.
   */
  authFor(record: McpServerConfig, serverUrl: string): OAuthConnectionAuth;
  /**
   * Drops the server's cached auth and retires its store instance (sign-in, logout, removal): a
   * retired store ignores late writes, so an old refresh cannot bring back removed tokens.
   */
  forget(serverId: string): void;
  /** Resolves once no refresh of any server is in flight. */
  settled(): Promise<void>;
}

/**
 * What the one-time migration of pi-mcp-adapter OAuth credentials did for one OAuth server
 * (oauth-migration.ts):
 * - `migrated`: the adapter's credentials now live in the service keychain entry, verified.
 * - `present`: the service keychain entry already held this URL's state; nothing was read.
 * - `none`: the adapter held nothing usable for the server's current URL; nothing was lost.
 * - `unmigratable`: usable credentials existed but could not be moved; the server needs sign-in.
 * - `retry`: a keychain could not be read or written; nothing is recorded, the next load retries.
 */
export type OAuthMigrationResult = 'migrated' | 'present' | 'none' | 'unmigratable' | 'retry';

export interface OAuthMigrationOutcome {
  serverId: string;
  result: OAuthMigrationResult;
  /** Why, for `unmigratable` and `retry`; shown as the status row's `lastError`, never a secret. */
  detail?: string;
}

/**
 * One MCP tool as runner proxies bind it (catalog.ts): the wire ref plus the tool's boolean
 * annotation hints, which pi reports through `getAllTools`. Hints never relax an approval.
 */
export interface McpToolInfo {
  ref: McpToolRef;
  annotations?: ToolAnnotations;
}

/** Test seams of `McpAuthority.createAuthority`; production passes none. */
export interface McpAuthorityOptions {
  /** Replaces `createTransport`, for in-memory servers. */
  transports?: McpTransportFactory;
}
