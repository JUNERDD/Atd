import { oneLine, urlTitle } from './bounds.js';
import type { WebPackage } from './package.js';
import type { ReadablePage } from './html.js';

/** Pages read from one PDF, pdf-extract.ts `DEFAULT_MAX_PAGES`. */
const MAX_PAGES = 100;

function textItem(item: unknown): { str: string; hasEOL: boolean } {
  if (typeof item !== 'object' || item === null) return { str: '', hasEOL: false };
  const { str, hasEOL } = item as Record<string, unknown>;
  return { str: typeof str === 'string' ? str : '', hasEOL: hasEOL === true };
}

/** One page's text, keeping the line breaks pdf.js reports so headings and rows stay apart. */
function pageText(items: unknown[]): string {
  const text = items
    .map((item) => {
      const { str, hasEOL } = textItem(item);
      return hasEOL ? `${str}\n` : str;
    })
    .join('');
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function metadataTitle(info: unknown): string {
  if (typeof info !== 'object' || info === null) return '';
  const { Title } = info as Record<string, unknown>;
  return typeof Title === 'string' ? oneLine(Title) : '';
}

/**
 * The text of a PDF through unpdf (pdf.js), on this machine only, as pdf-extract.ts does when
 * no extraction service is configured: at most `MAX_PAGES` pages, separated by
 * `<!-- Page n -->` markers, titled by the document's metadata or the URL. `signal` is checked
 * between pages since pdf.js does not observe it.
 */
export async function readablePdf(
  web: WebPackage,
  bytes: Uint8Array,
  url: string,
  signal: AbortSignal,
): Promise<ReadablePage> {
  const pdf = await web.getDocumentProxy(bytes, { verbosity: web.pdfVerbosity });
  try {
    const { info } = await pdf.getMetadata();
    const count = Math.min(pdf.numPages, MAX_PAGES);
    const sections: string[] = [];
    for (let number = 1; number <= count; number++) {
      signal.throwIfAborted();
      const page = await pdf.getPage(number);
      const text = pageText((await page.getTextContent()).items);
      if (text) sections.push(sections.length ? `<!-- Page ${number} -->\n\n${text}` : text);
    }
    if (!sections.length)
      throw new Error('The PDF has no extractable text (it may consist of scanned images).');
    if (pdf.numPages > count)
      sections.push(`[Truncated: only the first ${count} of ${pdf.numPages} pages were read.]`);
    return {
      title: metadataTitle(info) || urlTitle(url).replace(/\.pdf$/i, ''),
      content: sections.join('\n\n'),
    };
  } finally {
    await pdf.loadingTask.destroy();
  }
}
