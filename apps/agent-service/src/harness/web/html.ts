import { oneLine, urlTitle } from './bounds.js';
import type { WebPackage } from './package.js';

/**
 * Readable text shorter than this moves extraction on to the next fallback, as extract.ts
 * `MIN_USEFUL_CONTENT` does: Readability often keeps only a teaser of app-shell pages.
 */
const MIN_USEFUL_CONTENT = 500;

export interface ReadablePage {
  title: string;
  content: string;
}

/**
 * A Cloudflare interstitial served with HTTP 200 (extract.ts `isCloudflareChallenge`). The
 * `cf-mitigated` header is authoritative for any text response; the body check is HTML-only and
 * needs both challenge-platform markers, so a generic "Just a moment..." page never matches.
 */
export function isCloudflareChallenge(response: Response, text: string, isHtml: boolean): boolean {
  if (response.status !== 200) return false;
  if (response.headers.get('cf-mitigated') === 'challenge') return true;
  return (
    isHtml &&
    /<title>\s*Just a moment\.\.\.\s*<\/title>/i.test(text) &&
    text.includes('window._cf_chl_opt') &&
    text.includes('/cdn-cgi/challenge-platform/')
  );
}

/** Little body text but several scripts (extract.ts `isLikelyJSRendered`). */
function isLikelyJsRendered(html: string): boolean {
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1];
  if (body === undefined) return false;
  const text = body
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length < MIN_USEFUL_CONTENT && (html.match(/<script/gi) ?? []).length > 3;
}

function isDefuddleLog(args: unknown[]): boolean {
  const [prefix] = args;
  return typeof prefix === 'string' && /^Defuddle(?:$|\s|:)/.test(prefix);
}

/**
 * Defuddle on a fresh parse (Readability mutates the one it read), as extract.ts
 * `extractWithDefuddle`. Defuddle reports a failed parse only through `console.error`, so that
 * is intercepted for the synchronous parse alone: its own lines are dropped (the failure is
 * rethrown instead) and every other caller's output passes through.
 */
async function defuddle(web: WebPackage, html: string, url: string): Promise<ReadablePage | null> {
  const { document } = web.parseHTML(html);
  Object.defineProperty(document, 'location', { value: new URL(url), configurable: true });
  let processingError: unknown;
  const consoleError = console.error;
  console.error = (...args: unknown[]) => {
    if (!isDefuddleLog(args)) return consoleError(...args);
    if (args[1] === 'Error processing document:') processingError = args[2];
  };
  let pending: ReturnType<WebPackage['Defuddle']>;
  try {
    pending = web.Defuddle(document, url, { markdown: true, useAsync: false });
  } finally {
    console.error = consoleError;
  }
  const result = await pending;
  if (processingError !== undefined)
    throw new Error('Defuddle could not process the document.', { cause: processingError });
  return typeof result.content === 'string'
    ? {
        title: typeof result.title === 'string' ? oneLine(result.title) : '',
        content: result.content.trim(),
      }
    : null;
}

/**
 * The readable Markdown of an HTML page, following extract.ts `extractViaHttp`: Readability +
 * Turndown first; when that yields less than `MIN_USEFUL_CONTENT`, the page's RSC payload, then
 * Defuddle. Links the page declares (API catalogs, service descriptions) are appended. Without a
 * useful result it keeps the first non-empty short text (the article, Defuddle's, the body
 * text), and throws when there is none or the page is evidently rendered by JavaScript.
 * `responseUrl` is the URL after redirects; relative declared links resolve against it.
 */
export async function readableHtml(
  web: WebPackage,
  html: string,
  responseUrl: string,
  linkHeader: string | null,
  signal: AbortSignal,
): Promise<ReadablePage> {
  const { document } = web.parseHTML(html);
  const documentTitle = oneLine(document.title ?? '');
  const bodyText = (document.body?.textContent ?? '').replace(/\n\s*\n+/g, '\n\n').trim();
  const links = web.discoverDeclaredWebLinks(document, linkHeader, responseUrl);
  const page = (title: string, content: string): ReadablePage => ({
    title: title || documentTitle || urlTitle(responseUrl),
    content: web.appendDeclaredWebLinks(content, links),
  });

  const article = new web.Readability(document).parse();
  const articleTitle = oneLine(article?.title ?? '');
  const markdown =
    typeof article?.content === 'string'
      ? new web.Turndown({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
          .turndown(article.content)
          .trim()
      : '';
  if (markdown.length >= MIN_USEFUL_CONTENT) return page(articleTitle, markdown);

  const rsc = web.extractRSCContent(html);
  if (rsc && rsc.content.length >= MIN_USEFUL_CONTENT) return page(oneLine(rsc.title), rsc.content);

  signal.throwIfAborted();
  const defuddled = await defuddle(web, html, responseUrl);
  signal.throwIfAborted();
  const fallbackTitle = articleTitle || documentTitle || (defuddled?.title ?? '');
  if (defuddled && defuddled.content.length >= MIN_USEFUL_CONTENT)
    return page(fallbackTitle, defuddled.content);

  if (isLikelyJsRendered(html))
    throw new Error('The page appears to be rendered by JavaScript (content loads dynamically).');
  const short = markdown || defuddled?.content || bodyText;
  if (!short) throw new Error('Could not extract readable content from the HTML.');
  return page(fallbackTitle, short);
}
