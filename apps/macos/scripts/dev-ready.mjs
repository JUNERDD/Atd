/** Wait for this renderer and the authenticated service identity in this run's data directory. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function waitForServices({ rendererOrigin, dataDir, signal, log }) {
  // A failed service build can be repaired at any time; keep the completed native build pending.
  const started = performance.now();
  let reportedReason = null;
  while (!signal.aborted) {
    const probe = await probeServices({ rendererOrigin, dataDir, signal });
    if (probe.ready) return true;
    if (log && !signal.aborted && performance.now() - started >= 5_000) {
      const reason = !probe.rendererReady
        ? probe.serviceReady
          ? `Vite renderer at ${rendererOrigin.origin} is not reachable.`
          : `Vite renderer (${rendererOrigin.origin}) and development service are not ready.`
        : 'development agent service is not ready.';
      if (reason !== reportedReason) {
        reportedReason = reason;
        log(`Still waiting: ${reason}`);
      }
    }
    const interval = performance.now() - started < 3000 ? 50 : 200;
    await delay(interval, undefined, { signal }).catch(() => {});
  }
  return false;
}

export async function servicesReady({ rendererOrigin, dataDir, signal }) {
  return (await probeServices({ rendererOrigin, dataDir, signal })).ready;
}

async function rendererReady({ rendererOrigin, signal }) {
  try {
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(2000)]);
    const page = await fetch(rendererOrigin, {
      headers: { Accept: 'text/html' },
      signal: requestSignal,
    });
    if (!page.ok) return false;
    const contentType = page.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('text/html')) return false;
    const html = await page.text();
    return html.includes('/@vite/client') && html.includes('/src/main.tsx');
  } catch {
    return false;
  }
}

async function serviceEndpointReady({ dataDir, signal }) {
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
    const status = await fetch(new URL('/v1/status', url), {
      headers: { Authorization: `Bearer ${token}` },
      signal: requestSignal,
    });
    if (!status.ok) return false;
    const body = await status.json();
    return (
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

async function probeServices({ rendererOrigin, dataDir, signal }) {
  const [isRendererReady, isServiceReady] = await Promise.all([
    rendererReady({ rendererOrigin, signal }),
    serviceEndpointReady({ dataDir, signal }),
  ]);
  return {
    ready: isRendererReady && isServiceReady,
    rendererReady: isRendererReady,
    serviceReady: isServiceReady,
  };
}
