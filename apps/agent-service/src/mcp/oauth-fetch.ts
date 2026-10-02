import type { McpFetch } from '@earendil-works/pi-mcp';
import { MCP_OAUTH_REQUEST_TIMEOUT_MS } from './constants.js';
import { McpError } from './errors.js';

/**
 * The HTTP layer of OAuth flows (sign-in and connection-time refresh): every discovery,
 * registration and token request goes through it. It bounds each request in time, carries the
 * server's own HTTP headers to the server's origin as pi-mcp-adapter did (mcp-auth-fetch.ts), so a
 * server that needs a tenant or key header on its OAuth endpoints keeps working, and remembers
 * which requests failed, because pi-mcp swallows some of those failures.
 */

const HEADERS_MISSING = 'Missing environment credential in OAuth HTTP headers';
const HEADERS_FAILED = 'Failed to resolve OAuth HTTP headers';

/** The HTTP headers a server's record configures, resolved by the OAuth rules of launch resolution. */
export interface ServiceHeaders {
  /** Names the server in the error a failed resolution raises. */
  serverId: string;
  resolve(): Promise<Readonly<Record<string, string>>>;
}

export interface OAuthFlowFetch {
  fetch: McpFetch;
  /**
   * Throws what stopped the flow's requests that carried the server's headers: headers that could
   * not be resolved, or a request that failed (its cause could quote a header, so only fixed
   * words are kept). Requests without the headers are `unreachable()`'s. pi-mcp swallows the
   * failure of a token refresh and falls back to a browser redirect, which would misreport it as
   * "sign-in needed"; sign-in flows read this after every call.
   */
  check(): void;
  /**
   * The first request without the server's headers that failed at the network (DNS, TCP, TLS or
   * the time limit); a request its caller cancelled did not fail. A renewal that did not authorize
   * reads this after `check()`: an authorization server that cannot be reached is an error to
   * try again, not a sign-in to redo.
   */
  unreachable(): Error | undefined;
}

/**
 * The fetch of one OAuth flow of the server at `serverUrl`.
 * - Every request is bounded by `MCP_OAUTH_REQUEST_TIMEOUT_MS`. The signal pi-mcp gives a request
 *   and `signal` cancel it; that is no failure, a timeout is.
 * - Requests to that URL's origin carry the service headers, resolved when the first such request
 *   needs them and kept for the flow. Requests to any other origin, such as a separate
 *   authorization server, carry none.
 * - Headers the OAuth library sets for a request win over the service headers.
 * - A request that carries service headers follows no redirect, which could take them elsewhere,
 *   and fails without quoting its cause.
 * - A resolution failure is one of two fixed messages, never a value.
 */
export function oauthFlowFetch(options: {
  serverUrl: string;
  service: ServiceHeaders;
  /** The fetch to wrap; the caller's own, when it has one. */
  base?: McpFetch | undefined;
  signal?: AbortSignal | undefined;
}): OAuthFlowFetch {
  const { service, base } = options;
  const origin = new URL(options.serverUrl).origin;
  let resolving: Promise<Headers> | undefined;
  let failure: Error | undefined;
  let unreachable: Error | undefined;
  const serviceHeaders = () =>
    (resolving ??= resolveHeaders(service).catch((error: Error) => {
      failure ??= error;
      throw error;
    }));

  const flowFetch: McpFetch = async (input, init) => {
    const cancels = [init?.signal, options.signal].flatMap((signal) => (signal ? [signal] : []));
    const cancelled = cancels.length > 0 ? AbortSignal.any(cancels) : undefined;
    cancelled?.throwIfAborted();
    const carried =
      new URL(String(input)).origin === origin ? await serviceHeaders() : new Headers();
    const protectedRequest = [...carried].length > 0;
    const headers = new Headers(carried);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    try {
      return await (base ?? globalThis.fetch)(input, {
        ...init,
        headers,
        signal: AbortSignal.any([AbortSignal.timeout(MCP_OAUTH_REQUEST_TIMEOUT_MS), ...cancels]),
        ...(protectedRequest ? { redirect: 'error' as const } : {}),
      });
    } catch (error) {
      // Cancelled, by a signal of the caller's or from inside `base`: nothing failed.
      cancelled?.throwIfAborted();
      if (error instanceof Error && error.name === 'AbortError') throw error;
      if (!protectedRequest) {
        unreachable ??= error instanceof Error ? error : new TypeError('OAuth HTTP request failed');
        throw error;
      }
      // A refused redirect, DNS, TLS and connection failures alike: the cause could quote a header.
      failure ??= new TypeError('OAuth HTTP request failed');
      throw failure;
    }
  };
  return {
    fetch: flowFetch,
    check: () => {
      if (failure) throw failure;
    },
    unreachable: () => unreachable,
  };
}

/** Only the two messages of the OAuth header rules are known to be free of values. */
async function resolveHeaders(service: ServiceHeaders): Promise<Headers> {
  try {
    return new Headers(await service.resolve());
  } catch (error) {
    const known =
      error instanceof McpError &&
      (error.message === HEADERS_MISSING || error.message === HEADERS_FAILED);
    throw known ? error : new McpError('internal', service.serverId, HEADERS_FAILED);
  }
}
