import { counted, documentText, MAX_TEXT_CHARS } from './document.js';
import type { ExtractOutcome } from './jobs.js';
import { isPdfPasswordError, readPdfText } from './pdf-text.js';

/** Pages read from one PDF; the header says when a document has more. */
const MAX_PAGES = 1000;
/** Page ranges a no-text-layer warning names before summing up the rest. */
const LISTED_RANGES = 12;

/**
 * A PDF's text as `--- Page N ---` sections, a page without text marked `[No text layer]` and a
 * page pdf.js failed on `[Page not extracted]`, under a header that names the pages whose content
 * is missing and any pages left unread.
 */
export async function pdfDocument(bytes: Uint8Array, label: string): Promise<ExtractOutcome> {
  let pdf;
  try {
    pdf = await readPdfText(bytes, { maxPages: MAX_PAGES, maxChars: MAX_TEXT_CHARS });
  } catch (error) {
    if (isPdfPasswordError(error)) return { status: 'protected' };
    throw error;
  }
  const { pages, pageCount } = pdf;
  // pdf.js reads a text that merely shows a PDF's skeleton as a document without pages.
  if (!pageCount) return { status: 'failed', reason: 'it has no pages' };
  if (pages.every((text) => text === null))
    return { status: 'failed', reason: 'none of its pages could be read' };
  const warnings = missingPages(pages);
  if (pages.length < pageCount)
    warnings.push(
      `Only pages 1–${pages.length} of ${pageCount} were read; the rest are not included.`,
    );
  const body = pages
    .map((text, index) => `--- Page ${index + 1} ---\n${pageBody(text)}`)
    .join('\n\n');
  return {
    status: 'text',
    text: documentText({
      label,
      facts: [counted(pageCount, 'page')],
      included: 'text only; images and layout are not included',
      warnings,
      body,
    }),
  };
}

function pageBody(text: string | null): string {
  if (text === null) return '[Page not extracted]';
  return text || '[No text layer]';
}

/** Warnings naming the pages read without text: drawn or scanned, or failed in pdf.js. */
function missingPages(pages: readonly (string | null)[]): string[] {
  const numbers = (missing: (text: string | null) => boolean) =>
    pages.flatMap((text, index) => (missing(text) ? [index + 1] : []));
  const blank = numbers((text) => text === '');
  const failed = numbers((text) => text === null);
  const warnings: string[] = [];
  if (blank.length && blank.length === pages.length)
    warnings.push(
      'No page has a text layer (scanned or drawn), so the content of the pages is not included.',
    );
  else if (blank.length === 1)
    warnings.push(
      `${pageList(blank)} has no text layer (scanned or drawn), so its content is not included.`,
    );
  else if (blank.length)
    warnings.push(
      `${pageList(blank)} have no text layer (scanned or drawn), so their content is not included.`,
    );
  if (failed.length === 1)
    warnings.push(`${pageList(failed)} could not be read, so its content is not included.`);
  else if (failed.length)
    warnings.push(`${pageList(failed)} could not be read, so their content is not included.`);
  return warnings;
}

/** `Page 3`, `Pages 4–5`, `Pages 2, 4 and 7–9`; past `LISTED_RANGES` ranges the rest are counted. */
function pageList(pages: readonly number[]): string {
  const ranges: [number, number][] = [];
  for (const page of pages) {
    const last = ranges.at(-1);
    if (last && page === last[1] + 1) last[1] = page;
    else ranges.push([page, page]);
  }
  const shown = ranges
    .slice(0, LISTED_RANGES)
    .map(([from, to]) => (from === to ? `${from}` : `${from}–${to}`));
  const noun = pages.length === 1 ? 'Page' : 'Pages';
  if (ranges.length > LISTED_RANGES) {
    const rest = ranges.slice(LISTED_RANGES).reduce((sum, [from, to]) => sum + to - from + 1, 0);
    return `${noun} ${shown.join(', ')} and ${counted(rest, 'other page')}`;
  }
  const last = shown.pop() ?? '';
  return shown.length ? `${noun} ${shown.join(', ')} and ${last}` : `${noun} ${last}`;
}
