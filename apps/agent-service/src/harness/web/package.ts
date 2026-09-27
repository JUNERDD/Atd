import { createRequire } from 'node:module';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createJiti } from 'jiti';

/**
 * The parts of `pi-web-access 0.32.0` the web tools reuse, loaded module by module through jiti
 * from the package's TypeScript sources. The package factory (`index.ts`) and its bundled
 * `dist/index.js` are never loaded: index.ts statically imports the curator server, Gemini web
 * (browser cookies) and every keyed provider, and reads `web-search.json`. The modules loaded
 * here import none of those:
 *
 * - `duckduckgo.ts` (keyless search) → activity.ts, domain-filter-normalization.ts,
 *   search-result-count-normalization.ts; its `perplexity.ts` import is type-only and erased.
 * - `ssrf-protection.ts` (`fetchRemoteUrl`: public-address check on every hop, manual redirects)
 *   → utils.ts. Loading it probes whether a `web-search.json` exists (utils.ts
 *   `getWebSearchConfigDir`); the file is only opened by `loadSsrfConfig` /
 *   `loadFetchContentDomainPolicy`, which the web tools never call — they pass explicit options.
 * - `data-uri-sanitize.ts` (strips inline base64 data URIs from extracted text).
 *
 * `extract.ts` is deliberately not reused: it imports chrome-cookies.ts and feature-config.ts,
 * reads `web-search.json` for timeouts and routing, and falls back to keyed providers found in
 * the environment. The readable-HTML path it runs (linkedom → Readability → Turndown) is
 * recomposed in fetch.ts from the same package dependencies, resolved from the package's own
 * directory so their versions stay the ones the pinned package installed.
 */

const PACKAGE_VERSION = '0.32.0';

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface HtmlDocument {
  title: string;
  body: { textContent: string | null } | null;
}

interface ReadabilityArticle {
  title?: string | null;
  content?: string | null;
}

export interface WebPackage {
  searchDuckDuckGo: (
    query: string,
    options: { numResults: number; signal: AbortSignal },
  ) => Promise<{ results: unknown }>;
  fetchRemoteUrl: (
    url: string,
    init: RequestInit,
    options: { allowRanges: string[]; trustEnvProxy: boolean },
  ) => Promise<Response>;
  sanitizeInlineDataUris: (text: string, sourcePath: string) => { text: string };
  parseHTML: (html: string) => { document: HtmlDocument };
  Readability: new (document: HtmlDocument) => { parse: () => ReadabilityArticle | null };
  Turndown: new (options: { headingStyle: 'atx'; codeBlockStyle: 'fenced' }) => {
    turndown: (html: string) => string;
  };
}

let cached: Promise<WebPackage> | null = null;

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null)
    throw new Error(`pi-web-access: ${name} did not load as a module.`);
  return value as Record<string, unknown>;
}

/**
 * The export `name` of `mod` (or of its CommonJS `default`), checked to be callable. The
 * signature `T` is the one documented by the pinned package version; the version check in
 * `loadWebPackage` keeps it from drifting.
 */
function member<T>(mod: Record<string, unknown>, name: string): T {
  const inner = typeof mod.default === 'object' && mod.default !== null ? mod.default : {};
  const value = name === 'default' ? mod.default : (mod[name] ?? record(inner, name)[name]);
  if (typeof value !== 'function') throw new Error(`pi-web-access: ${name} is unavailable.`);
  return value as T;
}

async function packageDir(): Promise<string> {
  // No exports map: package.json is resolvable. Realpath so jiti resolves the package's own
  // dependencies (pnpm siblings exist only under the realpath).
  const manifest = createRequire(import.meta.url).resolve('pi-web-access/package.json');
  const dir = await realpath(path.dirname(manifest));
  const { version } = record(
    JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')),
    'package.json',
  );
  if (version !== PACKAGE_VERSION)
    throw new Error(`pi-web-access ${String(version)} is not the verified ${PACKAGE_VERSION} pin.`);
  return dir;
}

async function load(): Promise<WebPackage> {
  const dir = await packageDir();
  // Base inside the package: bare ids (linkedom, @mozilla/readability, turndown) resolve from it.
  const jiti = createJiti(path.join(dir, 'package.json'), { moduleCache: true, fsCache: true });
  const source = (file: string) => jiti.import(pathToFileURL(path.join(dir, file)).href);
  const duckduckgo = record(await source('duckduckgo.ts'), 'duckduckgo.ts');
  const ssrf = record(await source('ssrf-protection.ts'), 'ssrf-protection.ts');
  const dataUri = record(await source('data-uri-sanitize.ts'), 'data-uri-sanitize.ts');
  const linkedom = record(await jiti.import('linkedom'), 'linkedom');
  const readability = record(await jiti.import('@mozilla/readability'), '@mozilla/readability');
  const turndown = record(await jiti.import('turndown'), 'turndown');
  return {
    searchDuckDuckGo: member(duckduckgo, 'searchWithDuckDuckGo'),
    fetchRemoteUrl: member(ssrf, 'fetchRemoteUrl'),
    sanitizeInlineDataUris: member(dataUri, 'sanitizeInlineDataUris'),
    parseHTML: member(linkedom, 'parseHTML'),
    Readability: member(readability, 'Readability'),
    Turndown: member(turndown, 'default'),
  };
}

/** Loads the reused modules once per process; a failed load is retried on the next call. */
export function loadWebPackage(): Promise<WebPackage> {
  cached ??= load().catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}

/** Search hits from the package's response, keeping only well-formed entries. */
export function searchHits(results: unknown): SearchHit[] {
  if (!Array.isArray(results)) return [];
  return results.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return [];
    const { title, url, snippet } = item as Record<string, unknown>;
    return typeof title === 'string' && typeof url === 'string'
      ? [{ title, url, snippet: typeof snippet === 'string' ? snippet : '' }]
      : [];
  });
}
