import { failure, urlTitle } from './bounds.js';
import { isCloudflareChallenge, readableHtml, type ReadablePage } from './html.js';
import { loadWebPackage, WEB_PACKAGE_VERSION, type WebPackage } from './package.js';
import { readablePdf } from './pdf.js';

/** Per-URL request budget (headers, body and extraction), the package's default fetch timeout. */
const FETCH_TIMEOUT_MS = 30_000;
/** Largest body read, the package's default response limit. */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
/** Largest PDF read, pdf-extract.ts `DEFAULT_PDF_MAX_SIZE_MB`. */
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const HEADERS = {
  'User-Agent': `Mozilla/5.0 (compatible; pi-web-access/${WEB_PACKAGE_VERSION})`,
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.9,text/plain;q=0.8,*/*;q=0.5',
  'Accept-Language': 'en-US,en;q=0.9',
};

/** One fetched URL: its readable text (Markdown for HTML, extracted text for PDFs) or why it failed. */
export interface FetchedPage {
  url: string;
  title: string;
  content: string;
  error?: string;
}

function isTextual(mime: string): boolean {
  return (
    mime === '' ||
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/javascript' ||
    mime.endsWith('+json') ||
    mime.endsWith('+xml')
  );
}

/**
 * A PDF by its type, or by a `.pdf` path served with a generic binary type (pdf-extract.ts
 * `isPDF` takes the path alone, which would also send an HTML error page to the PDF reader).
 */
function isPdf(url: string, mime: string): boolean {
  if (mime === 'application/pdf') return true;
  const generic =
    mime === '' || mime === 'application/octet-stream' || mime === 'binary/octet-stream';
  return generic && new URL(url).pathname.toLowerCase().endsWith('.pdf');
}

/** Reads at most `limit` bytes; a larger body fails instead of being cut mid-document. */
async function readBody(response: Response, limit: number): Promise<Uint8Array> {
  const tooLarge = () => new Error(`Response too large (over ${limit / 1024 / 1024} MB).`);
  const declared = Number.parseInt(response.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel();
    throw tooLarge();
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** Decodes with the declared charset, falling back to UTF-8 for an unknown label. */
function decode(body: Uint8Array, contentType: string): string {
  const charset = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

/** A Markdown text's first level-1 or level-2 heading (extract.ts `extractHeadingTitle`). */
function headingTitle(text: string): string {
  return /^#{1,2}\s+(.+)/m.exec(text)?.[1]?.replace(/\*+/g, '').trim() ?? '';
}

/**
 * The page's readable text, following the package's HTTP path (extract.ts `extractViaHttp`)
 * without its keyed or browser fallbacks: PDFs through unpdf, Cloudflare challenge pages
 * refused, HTML through html.ts, other text as it is.
 */
async function readResponse(
  web: WebPackage,
  url: string,
  response: Response,
  signal: AbortSignal,
): Promise<ReadablePage> {
  const contentType = response.headers.get('content-type') ?? '';
  const mime = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  const responseUrl = response.url || url;
  if (isPdf(responseUrl, mime))
    return readablePdf(web, await readBody(response, MAX_PDF_BYTES), responseUrl, signal);
  const isHtml = mime === 'text/html' || mime === 'application/xhtml+xml';
  if (!isHtml && !isTextual(mime)) {
    await response.body?.cancel();
    throw new Error(`Unsupported content type: ${mime}`);
  }
  const text = decode(await readBody(response, MAX_RESPONSE_BYTES), contentType);
  if (isCloudflareChallenge(response, text, isHtml))
    throw new Error(`HTTP ${response.status}: Blocked by a Cloudflare challenge page.`);
  if (isHtml) return readableHtml(web, text, responseUrl, response.headers.get('link'), signal);
  return { title: headingTitle(text) || urlTitle(url), content: text };
}

async function fetchPage(
  web: WebPackage,
  url: string,
  signal: AbortSignal | undefined,
): Promise<FetchedPage> {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    // No proxy trust and no private ranges: every hop must resolve to a public address.
    const response = await web.fetchRemoteUrl(
      url,
      { signal: requestSignal, headers: HEADERS },
      { allowRanges: [], trustEnvProxy: false },
    );
    if (!response.ok) {
      await response.body?.cancel();
      return {
        url,
        title: '',
        content: '',
        error: `HTTP ${response.status} ${response.statusText}`.trim(),
      };
    }
    const page = await readResponse(web, url, response, requestSignal);
    // Parsing and PDF reading do not observe the signal: a budget spent meanwhile still fails.
    requestSignal.throwIfAborted();
    // As the package does for fetched text: inline base64 data URIs are replaced by markers.
    const content = web.sanitizeInlineDataUris(page.content, url).text;
    if (!content)
      return { url, title: page.title, content: '', error: 'No readable content found.' };
    return { url, title: page.title, content };
  } catch (error) {
    return { url, title: '', content: '', error: failure(error) };
  }
}

/** Parallel requests, as the package's `fetchAllContent` limit. */
const CONCURRENCY = 3;

/**
 * Fetches every URL (at most `CONCURRENCY` at a time) and returns the pages in input order; a
 * failed URL carries its `error`. Call only after the web gate allowed the call.
 */
export async function fetchPages(
  urls: string[],
  signal: AbortSignal | undefined,
): Promise<FetchedPage[]> {
  const web = await loadWebPackage();
  const pages: FetchedPage[] = Array.from({ length: urls.length });
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const index = next++;
      pages[index] = await fetchPage(web, urls[index] ?? '', signal);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
  return pages;
}
