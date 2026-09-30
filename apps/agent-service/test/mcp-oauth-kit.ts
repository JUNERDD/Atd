import assert from 'node:assert/strict';
import { Type } from 'typebox';
import { parse } from '@ai/agent-contracts';
import { oauthAccount } from '../dist/mcp/oauth-store.js';
import { client } from './launch-helpers.ts';
import { approveAuthorization } from './mcp-http-kit.ts';
import { at, waitFor } from './mcp-kit.ts';
import type { installMemoryKeyring } from './memory-keyring.ts';
import type { startTestService } from './service-harness.ts';

type Harness = Awaited<ReturnType<typeof startTestService>>;
const Started = Type.Object({ authorizationUrl: Type.String() });
type Keyring = ReturnType<typeof installMemoryKeyring>;

/**
 * What the OAuth end-to-end tests do to a running service, over its HTTP routes. The service and
 * the authorization server start in `before`, so a test asks for the helpers with the returned
 * function once it runs.
 */
export function oauthApi(harness: () => Harness, keyring: Keyring, defaultUrl: () => string) {
  let built: ReturnType<typeof build> | undefined;
  return () => (built ??= build(harness(), keyring, defaultUrl));
}

function build(harness: Harness, keyring: Keyring, defaultUrl: () => string) {
  const api = client(harness);
  const put = (
    serverId: string,
    options: { url?: string; headers?: Record<string, string> } = {},
  ) =>
    api.send(`/v1/mcp/servers/${serverId}`, 'PUT', {
      transport: 'streamable-http',
      url: options.url ?? defaultUrl(),
      auth: { type: 'oauth' },
      ...(options.headers ? { headers: options.headers } : {}),
    });
  const post = (route: string, serverId: string, extra: object = {}) =>
    api.send(route, 'POST', { serverId, ...extra });
  const row = async (serverId: string) =>
    at((await api.status()).servers.filter((server) => server.serverId === serverId));
  /** The service's keychain item of a server's sign-in, if it has one. */
  const stored = (serverId: string) =>
    keyring
      .accounts(harness.config.serviceId)
      .get(oauthAccount(harness.config.serviceId, { serverId, principal: '' }));

  /** Starts a sign-in and answers its authorization URL. */
  async function start(serverId: string): Promise<string> {
    const response = await post('/v1/mcp/auth/start', serverId);
    assert.equal(response.status, 200, response.text);
    return parse(Started, response.json).authorizationUrl;
  }

  /** Signs in through the browser redirect and waits until the service is done with it. */
  async function signIn(serverId: string): Promise<void> {
    await approveAuthorization(await start(serverId), { visit: true });
    await waitFor(async () => (await row(serverId)).state === 'disconnected');
  }
  return { api, put, post, row, stored, start, signIn };
}
