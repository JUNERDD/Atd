import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin, ProxyOptions } from 'vite';
import { resolveServiceDataDir } from '../electron/service/data-dir';

/** Answered for `/v1` while no service has published an endpoint yet. */
const NO_SERVICE = 'http://127.0.0.1:9';

/** One string field of a JSON file in the service data dir; null while it is missing. */
function readField(file: string, key: string): string | null {
  try {
    const value: unknown = JSON.parse(
      readFileSync(path.join(resolveServiceDataDir(), file), 'utf8'),
    );
    const field: unknown = typeof value === 'object' && value ? Reflect.get(value, key) : null;
    return typeof field === 'string' ? field : null;
  } catch {
    return null;
  }
}

/** The service the desktop app started (or `AI_AGENT_URL`), read again for every request. */
function serviceUrl(): string | null {
  return process.env.AI_AGENT_URL || readField('endpoint.json', 'url');
}

/**
 * Makes the dev server that `pnpm dev` already runs the web client too: open its origin in a
 * browser and the page works against the agent service the desktop app started.
 *
 * - `/v1` (HTTP and the stream) is proxied to the service. The desktop starts the service after
 *   this server and on a port the OS picks, so the target is resolved on every request: Vite
 *   hands `configure` the options object its proxy reads the target from per call.
 * - `/__ai/dev-pair` mints a one-time pairing code with the local owner token, so the page signs
 *   itself in without a link. It answers same-origin requests only (`Sec-Fetch-Site`, which pages
 *   cannot forge): another local site cannot obtain a session through it.
 *
 * Development only; the built web client is served by the service and pairs through a link.
 */
export function agentServiceDev(): Plugin {
  let proxied: ProxyOptions | null = null;
  const proxy: ProxyOptions = {
    target: NO_SERVICE,
    changeOrigin: true,
    ws: true,
    configure: (_server, options) => {
      proxied = options;
    },
    bypass: () => {
      if (proxied) proxied.target = serviceUrl() ?? NO_SERVICE;
      return undefined;
    },
  };
  return {
    name: 'agent-service-dev',
    apply: 'serve',
    config: () => ({ server: { proxy: { '/v1': proxy } } }),
    configureServer(server) {
      server.middlewares.use('/__ai/dev-pair', (request, response) => {
        const reply = (status: number, body: unknown) => {
          response.statusCode = status;
          response.setHeader('content-type', 'application/json');
          response.setHeader('cache-control', 'no-store');
          response.end(JSON.stringify(body));
        };
        if (request.method !== 'POST' || request.headers['sec-fetch-site'] !== 'same-origin')
          return reply(403, { error: 'Same-origin POST only.' });
        const url = serviceUrl();
        const token = readField(path.join('auth', 'token'), 'token');
        if (!url || !token) return reply(503, { error: 'The agent service is not running.' });
        fetch(`${url}/v1/web/pairings`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        })
          .then(async (answer) => reply(answer.status, await answer.json()))
          .catch(() => reply(503, { error: 'The agent service is not reachable.' }));
      });
    },
  };
}
