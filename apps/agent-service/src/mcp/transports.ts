import {
  StdioTransport,
  StreamableHttpTransport,
  type AuthProvider,
  type McpTransport,
} from '@earendil-works/pi-mcp';
import { LegacySseTransport } from './legacy-sse.js';
import type { McpHttpLaunch, McpTransportFactory, OAuthConnectionAuth } from './types.js';

/**
 * Builds the pi-mcp transport of one resolved launch. The launch is already fully resolved, so
 * this only wires it up: a stdio child gets exactly the environment the resolver built (pi-mcp's
 * `inheritEnv: false` adds nothing), and its stderr is piped so a failed start can say why.
 */
export const createTransport: McpTransportFactory = (launch, auth): McpTransport => {
  if (launch.kind === 'stdio') {
    return new StdioTransport({
      command: launch.command,
      args: launch.args,
      cwd: launch.cwd,
      env: launch.env,
      inheritEnv: false,
      stderr: 'pipe',
    });
  }
  const options = {
    url: launch.url,
    headers: launch.headers,
    authProvider: authProviderOf(launch, auth),
  };
  return launch.kind === 'sse'
    ? new LegacySseTransport(options)
    : new StreamableHttpTransport(options);
};

/**
 * OAuth servers use the server's shared connection auth. A bearer token goes out as configured,
 * as `Authorization: Bearer <token>` on every request, and wins over a configured `Authorization`
 * header (both transports set it last).
 */
function authProviderOf(
  launch: McpHttpLaunch,
  auth: OAuthConnectionAuth | undefined,
): AuthProvider | undefined {
  const { credential } = launch;
  switch (credential.type) {
    case 'none':
      return undefined;
    case 'bearer': {
      const { token } = credential;
      return { token: async () => token };
    }
    case 'oauth':
      if (!auth) throw new Error('An OAuth launch needs the server connection auth.');
      return auth;
  }
}
