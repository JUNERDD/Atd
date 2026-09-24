import { failure, oneLine } from './bounds.js';
import { loadWebPackage, type WebPackage } from './package.js';

/** Per-URL request budget (headers and body), the package's default fetch timeout. */
const FETCH_TIMEOUT_MS = 30_000;
/** Largest body read, the package's default response limit. */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; pi-web-access/0.31.0)',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
  'Accept-Language': 'en-US,en;q=0.9',
};

/** One fetched URL: its readable text (Markdown for HTML) or why it failed. */
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

/** Reads at most `MAX_RESPONSE_BYTES`; a larger body fails instead of being cut mid-document. */
async function readBody(response: Response): Promise<string> {
  const declared = Number.parseInt(response.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES)
    throw new Error(`Response too large (${Math.round(declared / 1024 / 1024)} MB).`);
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('Response too large (over 5 MB).');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function urlTitle(url: string): string {
  const { hostname, pathname } = new URL(url);
  return pathname.split('/').filter(Boolean).pop() ?? hostname;
}

/**
 * The package's readable-HTML path (extract.ts `extractViaHttp`): linkedom parses, Readability
 * picks the article, Turndown converts it to Markdown. Pages Readability cannot parse fall back
 * to the body text instead of the package's keyed or browser fallbacks.
 */
function readableHtml(
  web: WebPackage,
  html: string,
  url: string,
): { title: string; content: string } {
  const { document } = web.parseHTML(html);
  const documentTitle = oneLine(document.title ?? '');
  const bodyText = document.body?.textContent ?? '';
  const article = new web.Readability(document).parse();
  if (article && typeof article.content === 'string') {
    const markdown = new web.Turndown({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
      .turndown(article.content)
      .trim();
    if (markdown)
      return {
        title: oneLine(article.title ?? '') || documentTitle || urlTitle(url),
        content: markdown,
      };
  }
  return {
    title: documentTitle || urlTitle(url),
    content: bodyText.replace(/\n\s*\n+/g, '\n\n').trim(),
  };
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
    const mime =
      (response.headers.get('content-type') ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
    const isHtml = mime === 'text/html' || mime === 'application/xhtml+xml';
    if (!isHtml && !isTextual(mime)) {
      await response.body?.cancel();
      return { url, title: '', content: '', error: `Unsupported content type: ${mime}` };
    }
    const body = await readBody(response);
    const page = isHtml ? readableHtml(web, body, url) : { title: urlTitle(url), content: body };
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
  const pages: FetchedPage[] = new Array<FetchedPage>(urls.length);
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
