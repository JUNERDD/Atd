import { workerPdfText } from '../../file-loader/extract.js';
import { oneLine, urlTitle } from './bounds.js';
import type { ReadablePage } from './html.js';

/** Pages read from one PDF, pdf-extract.ts `DEFAULT_MAX_PAGES`. */
const MAX_PAGES = 100;

/**
 * The text of a PDF on this machine, as pdf-extract.ts reads it when no extraction service is
 * configured: at most `MAX_PAGES` pages through the file loader's PDF text core, in one of its
 * extraction workers (file-loader/extract.ts, which bounds its time and memory and terminates it
 * when `signal` aborts), separated by `<!-- Page n -->` markers, titled by the document's
 * metadata or the URL.
 */
export async function readablePdf(
  bytes: Uint8Array,
  url: string,
  signal: AbortSignal,
): Promise<ReadablePage> {
  const pdf = await workerPdfText(bytes, MAX_PAGES, signal);
  const sections: string[] = [];
  pdf.pages.forEach((text, index) => {
    if (text) sections.push(sections.length ? `<!-- Page ${index + 1} -->\n\n${text}` : text);
  });
  if (!sections.length)
    throw new Error('The PDF has no extractable text (it may consist of scanned images).');
  if (pdf.pageCount > pdf.pages.length)
    sections.push(
      `[Truncated: only the first ${pdf.pages.length} of ${pdf.pageCount} pages were read.]`,
    );
  return {
    title: oneLine(pdf.title) || urlTitle(url).replace(/\.pdf$/i, ''),
    content: sections.join('\n\n'),
  };
}
