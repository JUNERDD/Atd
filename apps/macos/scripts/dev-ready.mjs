/** Wait for this renderer and the authenticated service identity in this run's data directory. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function waitForServices({ rendererOrigin, dataDir, signal }) {
  // A failed service build can be repaired at any time; keep the completed native build pending.
  while (!signal.aborted) {
    if (await servicesReady({ rendererOrigin, dataDir, signal })) return true;
    await delay(250, undefined, { signal }).catch(() => {});
  }
  return false;
}

export async function servicesReady({ rendererOrigin, dataDir, signal }) {
  try {
    const [endpointText, tokenText] = await Promise.all([
      readFile(path.join(dataDir, 'endpoint.json'), 'utf8'),
      readFile(path.join(dataDir, 'auth/token'), 'utf8'),
    ]);
    const endpoint = JSON.parse(endpointText);
    const { token } = JSON.parse(tokenText);
    const url = new URL(endpoint.url);
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
      !Number.isInteger(endpoint.pid) ||
      endpoint.pid <= 0 ||
      typeof token !== 'string' ||
      !token
    )
      return false;
    process.kill(endpoint.pid, 0);
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(2000)]);
    const [page, status] = await Promise.all([
      fetch(rendererOrigin, { signal: requestSignal }),
      fetch(new URL('/v1/status', url), {
        headers: { Authorization: `Bearer ${token}` },
        signal: requestSignal,
      }),
    ]);
    if (!page.ok || !status.ok) return false;
    const [html, body] = await Promise.all([page.text(), status.json()]);
    return (
      html.includes('/@vite/client') &&
      html.includes('/src/main.tsx') &&
      body.service?.service === 'agent-service' &&
      body.service.serviceId === endpoint.serviceId &&
      body.service.epoch === endpoint.epoch &&
      body.service.startedAt === endpoint.startedAt &&
      body.service.endpoint?.url === endpoint.url &&
      !body.draining
    );
  } catch {
    return false; // Startup, a mid-write, or a service restart; the next attempt re-reads identity.
  }
}
