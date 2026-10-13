import type { EndpointCapabilities } from './endpoint-capabilities.js';

/**
 * Best-effort reads of a local server's native API, which publishes what its thin OpenAI-compatible
 * `/models` list leaves out. Unlike `readCatalogJson`, a probe never throws: any failure (refused,
 * non-2xx, oversized, invalid JSON, timeout) is `undefined`, and discovery keeps what `/models`
 * gave. Reads stay on the connection's own host and never follow redirects, so its credential
 * cannot leak elsewhere.
 */

/** What one server's native API adds per `/models` id; ids it says nothing about are absent. */
export type NativeProbe = (
  ids: readonly string[],
  read: ProbeReader,
) => Promise<Map<string, EndpointCapabilities>>;

/** Reads one native endpoint under the server root (`/api/show`), with an optional JSON body. */
export type ProbeReader = (path: string, body?: object) => Promise<unknown>;

/** The whole probe phase shares one deadline, so a slow server delays a refresh by at most this. */
const PHASE_TIMEOUT_MS = 15000;
const REQUEST_TIMEOUT_MS = 5000;
/** Native model descriptions carry license and template text, never megabytes. */
const MAX_BYTES = 2 * 1024 * 1024;

/** Native APIs live at the server root; the connection's base URL is its `/v1` mount. */
export function serverRoot(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
}

async function readBounded(response: Response): Promise<string | undefined> {
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) return undefined;
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** A reader for one discovery pass: same headers as the `/models` read, one shared deadline. */
export function probeReader(root: string, headers: Record<string, string>): ProbeReader {
  const phase = AbortSignal.timeout(PHASE_TIMEOUT_MS);
  return async (path, body) => {
    try {
      const response = await fetch(`${root}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: 'manual',
        signal: AbortSignal.any([phase, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return undefined;
      }
      const text = await readBounded(response);
      return text === undefined ? undefined : JSON.parse(text);
    } catch {
      return undefined;
    }
  };
}

/** Runs `task` over `items` with at most `limit` in flight, keeping input order. */
export async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  // Workers pull from one shared iterator, so each item runs exactly once.
  const queue = items.entries();
  const worker = async () => {
    for (const [index, item] of queue) results[index] = await task(item);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
