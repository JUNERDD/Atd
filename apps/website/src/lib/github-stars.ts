export const GITHUB_REPO = 'JUNERDD/Atd';
export const GITHUB_STARS_FALLBACK = 56;
export const STAR_META_NAME = 'atd:stars';

const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}`;
const UPSTREAM_TIMEOUT_MS = 4000;
const CDN_CACHE_CONTROL =
  'public, s-maxage=1800, stale-while-revalidate=86400, stale-if-error=86400';

export interface FetchGitHubStarsOptions {
  token?: string | undefined;
  signal?: AbortSignal | undefined;
}

function readIntegerField(payload: unknown, key: string): number | null {
  if (typeof payload !== 'object' || payload === null || !(key in payload)) return null;
  const value: unknown = Reflect.get(payload, key);
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** Parses GitHub's repository response (`stargazers_count`). */
export function parseGitHubStars(payload: unknown): number | null {
  return readIntegerField(payload, 'stargazers_count');
}

/** Parses this site's cached `/api/github` JSON response (`stars`). */
export function parseApiStars(payload: unknown): number | null {
  return readIntegerField(payload, 'stars');
}

/** Formats repository star counts compactly (`56`, `999`, `1.2k`, `12k`). */
export function formatGitHubStars(stars: number): string {
  if (stars < 1000) return String(stars);
  if (stars < 10000) return `${(stars / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(stars / 1000)}k`;
}

/** Reads the star snapshot rendered into `<meta name="atd:stars">` for hydration parity. */
export function readInitialStars(): number {
  const raw = document.querySelector(`meta[name="${STAR_META_NAME}"]`)?.getAttribute('content');
  if (!raw) return GITHUB_STARS_FALLBACK;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : GITHUB_STARS_FALLBACK;
}

/** Fetches the current repository star count from GitHub's REST API, or `null` on failure. */
export async function fetchGitHubStars(
  options: FetchGitHubStarsOptions = {},
): Promise<number | null> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  if (options.signal?.aborted) return null;
  options.signal?.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'atd-website',
    };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    const response = await fetch(GITHUB_API_URL, {
      headers,
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    return parseGitHubStars(payload);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onParentAbort);
  }
}

function jsonResponse(
  status: number,
  body: unknown,
  cacheControl: string,
  extraHeaders: Record<string, string> = {},
  headOnly = false,
): Response {
  return new Response(headOnly ? null : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
      ...extraHeaders,
    },
  });
}

/**
 * Handles `GET`/`HEAD /api/github` for both the Vercel Node Function and local Vite dev/preview
 * middleware so both share identical validation, caching headers, and error responses.
 */
export async function handleGitHubStarsRequest(
  request: Request,
  token?: string,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonResponse(405, { error: 'method_not_allowed' }, 'no-store', { Allow: 'GET, HEAD' });
  }

  const stars = await fetchGitHubStars({ token, signal: request.signal });
  const headOnly = request.method === 'HEAD';
  if (stars === null) {
    console.error('[api/github] failed to retrieve GitHub star count');
    return jsonResponse(502, { error: 'upstream_unavailable' }, 'no-store', {}, headOnly);
  }

  return jsonResponse(200, { stars }, CDN_CACHE_CONTROL, {}, headOnly);
}
