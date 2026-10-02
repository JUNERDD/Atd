/**
 * Values the MCP layer on `@earendil-works/pi-mcp` keeps from what pi-mcp-adapter 3.1.0 did as the
 * service configured it, or takes from pi's own MCP runtime (pi-coding-agent 1.0.0
 * `dist/extensions/mcp`). Each value names its source; changing one changes user-visible
 * behavior.
 */

/**
 * Request timeout of a record without `requestTimeoutMs`. The service never set the adapter's
 * default, so its MCP SDK default applied (`DEFAULT_REQUEST_TIMEOUT_MSEC`,
 * @modelcontextprotocol/client 2.0.0); pi-mcp's own default is 30 s. Progress renews it.
 */
export const MCP_REQUEST_TIMEOUT_MS = 60_000;

/** A base connection with nothing in flight for this long closes (the adapter's idle timeout). */
export const MCP_IDLE_CLOSE_MS = 10 * 60_000;

/** How often the pool looks for idle base connections. Task aliases never idle-close. */
export const MCP_IDLE_CHECK_MS = 60_000;

/**
 * Delays before retrying an HTTP connect that failed transiently (408, 429, 5xx but 501, a connection
 * that broke), as pi's runtime does. A server that is absent or untrusted (refused, not found,
 * unreachable, connect timeout, TLS certificate error) fails at once, as the adapter did
 * (errors.ts `isTransientConnectError`); stdio connects are not retried.
 */
export const MCP_CONNECT_RETRY_DELAYS_MS: readonly number[] = [250, 1_000];

/** `clientInfo.name` is this prefix and the physical name, as the adapter sent it. */
export const MCP_CLIENT_NAME_PREFIX = 'pi-mcp-';

/** `clientInfo.version` in initialize. */
export const MCP_CLIENT_VERSION = '1.0.0';

/**
 * The variables a stdio server inherits from the service besides its own env, skipping values that
 * start with `()`: the MCP SDK's `getDefaultEnvironment`, which the adapter's stdio transport
 * added under `inheritEnv: false`. pi-mcp's `StdioTransport` adds nothing, so the app does.
 */
export const MCP_INHERITED_ENV_KEYS = {
  posix: ['HOME', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'USER'],
  win32: [
    'APPDATA',
    'HOMEDRIVE',
    'HOMEPATH',
    'LOCALAPPDATA',
    'PATH',
    'PROCESSOR_ARCHITECTURE',
    'SYSTEMDRIVE',
    'SYSTEMROOT',
    'TEMP',
    'USERNAME',
    'USERPROFILE',
    'PROGRAMFILES',
  ],
} as const;

/** `client_name` in dynamic client registration (the name servers.ts always meant to send). */
export const MCP_OAUTH_CLIENT_NAME = 'Agent Service';

/** The loopback callback listens here; the redirect URI names `MCP_OAUTH_REDIRECT_HOST`. */
export const MCP_OAUTH_CALLBACK_HOST = '127.0.0.1';

/** Host in the redirect URI, as the adapter registered it (`http://localhost:<port>/callback`). */
export const MCP_OAUTH_REDIRECT_HOST = 'localhost';

export const MCP_OAUTH_CALLBACK_PATH = '/callback';

/** A started sign-in waits this long for its callback or pasted code (the adapter's timeout). */
export const MCP_OAUTH_FLOW_TTL_MS = 5 * 60_000;

/** Each OAuth discovery, registration or token request (the adapter's default). */
export const MCP_OAUTH_REQUEST_TIMEOUT_MS = 30_000;

/** An access token this close to expiry is refreshed before it is sent (pi's runtime). */
export const MCP_OAUTH_REFRESH_SKEW_MS = 30_000;

/** Redirect URI a refresh uses when no registered one is stored; a refresh never redirects. */
export const MCP_OAUTH_FALLBACK_REDIRECT_URL = 'http://127.0.0.1/callback';

/**
 * Per-server record of the one-time adapter credential migration, in `securityDir(dataDir)`
 * (launch-store.ts), which the agent's file tools cannot write: a logged-out server is never
 * imported again.
 */
export const MCP_OAUTH_MIGRATION_FILE = 'mcp-oauth-migration.json';

/** The OS keychain service pi-mcp-adapter kept OAuth credentials under; read by migration only. */
export const LEGACY_ADAPTER_OAUTH_SERVICE = 'pi-mcp-adapter.oauth';

/** The adapter's plaintext import directory under the data dir (`MCP_OAUTH_DIR`); read only. */
export const LEGACY_ADAPTER_OAUTH_DIR = 'mcp-oauth';

/** Key of the manifest the adapter stored in place of a record split into chunks. */
export const LEGACY_ADAPTER_CHUNK_MARKER = '__piMcpAdapterOAuthChunked';
