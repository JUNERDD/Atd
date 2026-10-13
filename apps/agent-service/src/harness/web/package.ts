import { createRequire } from 'node:module';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createJiti } from 'jiti';

/**
 * The parts of `pi-web-access 0.37.0` the web tools reuse, loaded module by module through jiti
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
 *   `loadFetchContentDomainPolicy`, which the web tools never call — they pass explicit options —
 *   and by `loadConfiguredProxy`, which `fetchRemoteUrl` reaches only with a proxy in play.
 * - `data-uri-sanitize.ts` (strips inline base64 data URIs from extracted text).
 * - `rsc-extract.ts` (Next.js React Server Components payloads) and `declared-web-links.ts`
 *   (RFC 8288 / `<link rel>` declarations such as `service-desc`); neither imports anything.
 *
 * `extract.ts` is deliberately not reused: it imports chrome-cookies.ts and feature-config.ts,
 * reads `web-search.json` for timeouts and routing, and falls back to keyed providers found in
 * the environment. Neither is `pdf-extract.ts`: it uploads PDFs to Datalab or Gemini when their
 * keys are in the environment, reads `web-search.json` and writes the text to a temp file. Their
 * HTTP path (extract.ts `extractViaHttp`: linkedom → Readability → Turndown, with the RSC and
 * Defuddle fallbacks, and unpdf for PDFs) is recomposed in fetch.ts, html.ts and pdf.ts from the
 * same package dependencies (linkedom, @mozilla/readability, turndown, `defuddle/node`, unpdf),
 * resolved from the package's own directory so their versions stay the ones the pinned package
 * installed.
 */

/** The version the module list above was verified against; `loadWebPackage` refuses others. */
export const WEB_PACKAGE_VERSION = '0.37.0';

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/** A linkedom document; html.ts reads its title and body and passes it on to the helpers. */
export interface HtmlDocument {
  title: string;
  body: { textContent: string | null } | null;
}

interface ReadabilityArticle {
  title?: string | null;
  content?: string | null;
}

/** declared-web-links.ts `DeclaredWebLink`. */
export interface DeclaredWebLink {
  url: string;
  relations: string[];
  type?: string;
}

/** The subset of pdf.js `PDFDocumentProxy` pdf.ts reads. */
export interface PdfDocument {
  numPages: number;
  getMetadata: () => Promise<{ info: unknown }>;
  getPage: (pageNumber: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }>;
  /** Destroying the loading task frees the document (pdf.js 5 has no `destroy` on the proxy). */
  loadingTask: { destroy: () => Promise<void> };
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
  extractRSCContent: (html: string) => { title: string; content: string } | null;
  discoverDeclaredWebLinks: (
    document: HtmlDocument,
    linkHeader: string | null,
    responseUrl: string,
  ) => DeclaredWebLink[];
  appendDeclaredWebLinks: (content: string, links: DeclaredWebLink[]) => string;
  parseHTML: (html: string) => { document: HtmlDocument };
  Readability: new (document: HtmlDocument) => { parse: () => ReadabilityArticle | null };
  Turndown: new (options: { headingStyle: 'atx'; codeBlockStyle: 'fenced' }) => {
    turndown: (html: string) => string;
  };
  /** `defuddle/node`; with `useAsync: false` it parses synchronously before returning. */
  Defuddle: (
    document: HtmlDocument,
    url: string,
    options: { markdown: true; useAsync: false },
  ) => Promise<{ title?: unknown; content?: unknown }>;
  getDocumentProxy: (data: Uint8Array, options: { verbosity: number }) => Promise<PdfDocument>;
  /** pdf.js `VerbosityLevel.ERRORS`: warnings about malformed PDFs stay off the service log. */
  pdfVerbosity: number;
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
  if (version !== WEB_PACKAGE_VERSION)
    throw new Error(
      `pi-web-access ${String(version)} is not the verified ${WEB_PACKAGE_VERSION} pin.`,
    );
  return dir;
}

async function load(): Promise<WebPackage> {
  const dir = await packageDir();
  // Base inside the package: its dependencies' bare ids (linkedom, defuddle, unpdf…) resolve
  // from it.
  const jiti = createJiti(path.join(dir, 'package.json'), { moduleCache: true, fsCache: true });
  const source = (file: string) => jiti.import(pathToFileURL(path.join(dir, file)).href);
  const duckduckgo = record(await source('duckduckgo.ts'), 'duckduckgo.ts');
  const ssrf = record(await source('ssrf-protection.ts'), 'ssrf-protection.ts');
  const dataUri = record(await source('data-uri-sanitize.ts'), 'data-uri-sanitize.ts');
  const rsc = record(await source('rsc-extract.ts'), 'rsc-extract.ts');
  const declared = record(await source('declared-web-links.ts'), 'declared-web-links.ts');
  const linkedom = record(await jiti.import('linkedom'), 'linkedom');
  const readability = record(await jiti.import('@mozilla/readability'), '@mozilla/readability');
  const turndown = record(await jiti.import('turndown'), 'turndown');
  const defuddle = record(await jiti.import('defuddle/node'), 'defuddle/node');
  const unpdf = record(await jiti.import('unpdf'), 'unpdf');
  const pdfjs = record(await jiti.import('unpdf/pdfjs'), 'unpdf/pdfjs');
  const { ERRORS } = record(pdfjs.VerbosityLevel, 'VerbosityLevel');
  if (typeof ERRORS !== 'number') throw new Error('pi-web-access: VerbosityLevel is unavailable.');
  return {
    searchDuckDuckGo: member(duckduckgo, 'searchWithDuckDuckGo'),
    fetchRemoteUrl: member(ssrf, 'fetchRemoteUrl'),
    sanitizeInlineDataUris: member(dataUri, 'sanitizeInlineDataUris'),
    extractRSCContent: member(rsc, 'extractRSCContent'),
    discoverDeclaredWebLinks: member(declared, 'discoverDeclaredWebLinks'),
    appendDeclaredWebLinks: member(declared, 'appendDeclaredWebLinks'),
    parseHTML: member(linkedom, 'parseHTML'),
    Readability: member(readability, 'Readability'),
    Turndown: member(turndown, 'default'),
    Defuddle: member(defuddle, 'Defuddle'),
    getDocumentProxy: member(unpdf, 'getDocumentProxy'),
    pdfVerbosity: ERRORS,
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
