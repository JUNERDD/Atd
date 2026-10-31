import { counted, documentText, MAX_TEXT_CHARS } from './document.js';
import { lineCount } from './material.js';
import type { PdfText, PdfTextOptions } from './pdf-text.js';

/**
 * What the loader reads of a PDF: at most 1,000 pages, and no further page once the text read
 * holds `MAX_TEXT_CHARS`. The header says when a document has more.
 */
export const PDF_LIMITS: PdfTextOptions = { maxPages: 1000, maxChars: MAX_TEXT_CHARS };
/** Page ranges a no-text-layer warning names before summing up the rest. */
const LISTED_RANGES = 12;

/**
 * The text recognized on a PDF's pages without a text layer (pdf-ocr.ts), by page number: '' for a
 * page that showed no text.
 */
export interface PageRecognition {
  pages: ReadonlyMap<number, string>;
  /**
   * Why recognition ended before the material did, as words after "text recognition" (`stopped
   * after 30 seconds`). The pages it did not reach keep their marker.
   */
  stopped?: string;
}

/** A page's section in the document text, and where `read` has that page. */
interface PageLines {
  /** The section's first line, the page's marker. */
  line: number;
  /** Lines the section takes. */
  lines: number;
  /** The page's first line in the file's text as `read` returns it. */
  readLine: number;
  /** Whether the section holds recognized text, of which `read` has only the page's marker. */
  recognized: boolean;
}

/**
 * How a PDF's text with recognized pages lines up with the file's text as `read` returns it, which
 * holds no recognized text and has `total` lines.
 */
export interface ReadLines {
  total: number;
  pages: readonly PageLines[];
}

/** A PDF's document text, with `readLines` when it may hold recognized text, or why it has none. */
export type PdfOutcome =
  | { status: 'text'; text: string; readLines?: ReadLines }
  | { status: 'failed'; reason: string };

/**
 * A PDF's text as `--- Page N ---` sections, a page without text marked `[No text layer]` and a
 * page pdf.js failed on `[Page not extracted]`, under a header that names the pages whose content
 * is missing and any pages left unread. A page `recognition` holds becomes a `--- Page N (OCR) ---`
 * section, as the file-loader skill's OCR script prints it, and the header says so.
 */
export function pdfDocument(
  pdf: Pick<PdfText, 'pageCount' | 'pages'>,
  label: string,
  recognition?: PageRecognition,
): PdfOutcome {
  const { pages, pageCount } = pdf;
  // pdf.js reads a text that merely shows a PDF's skeleton as a document without pages.
  if (!pageCount) return { status: 'failed', reason: 'it has no pages' };
  if (pages.every((text) => text === null))
    return { status: 'failed', reason: 'none of its pages could be read' };
  const shown = composed(pdf, label, recognition);
  if (!recognition) return { status: 'text', text: shown.text };
  const plain = composed(pdf, label);
  const lines = shown.sections.map((section, index) => ({
    ...section,
    readLine: plain.sections[index]?.line ?? section.line,
    recognized: recognition.pages.has(index + 1),
  }));
  return {
    status: 'text',
    text: shown.text,
    readLines: { total: lineCount(plain.text), pages: lines },
  };
}

/**
 * A page's section of the document text: its `--- Page N ---` marker and its text, or with
 * `recognized` its `--- Page N (OCR) ---` marker and the text recognized on it.
 */
export function pageSection(number: number, text: string | null, recognized?: string): string {
  if (recognized !== undefined)
    return `--- Page ${number} (OCR) ---\n${recognized || '[No text recognized]'}`;
  return `--- Page ${number} ---\n${text === null ? '[Page not extracted]' : text || '[No text layer]'}`;
}

/**
 * The line `read` continues from once the material shows the first `shown` lines of a text with
 * recognized pages (material.ts `MaterialSource.readLine`). `read` has only the marker of a
 * recognized page: past the page's text it continues with the next page, and inside it from the
 * page's marker.
 */
export function readLineAfter({ pages }: ReadLines, shown: number): number {
  const index = pages.findLastIndex((page) => page.line <= shown);
  const page = pages[index];
  // Inside the header, which may have a warning more or fewer than `read`'s.
  if (!page) return Math.min(shown, (pages[0]?.readLine ?? 1) - 1) + 1;
  if (!page.recognized) return page.readLine + shown - page.line + 1;
  const next = pages[index + 1];
  return next && shown >= page.line + page.lines - 1 ? next.readLine : page.readLine;
}

/** The document text, and the first line and length of each page's section in it. */
function composed(
  { pages, pageCount }: Pick<PdfText, 'pageCount' | 'pages'>,
  label: string,
  recognition?: PageRecognition,
): { text: string; sections: { line: number; lines: number }[] } {
  const warnings = missingPages(pages, recognition);
  if (pages.length < pageCount)
    warnings.push(
      `Only pages 1–${pages.length} of ${pageCount} were read; the rest are not included.`,
    );
  const bodies = pages.map((text, index) =>
    pageSection(index + 1, text, recognition?.pages.get(index + 1)),
  );
  // The body follows the header line, a line per warning and a blank line (document.ts).
  let line = warnings.length + 3;
  const sections = bodies.map((body) => {
    const section = { line, lines: lineCount(body) };
    line += section.lines + 1;
    return section;
  });
  const text = documentText({
    label,
    facts: [counted(pageCount, 'page')],
    included: 'text only; images and layout are not included',
    warnings,
    body: bodies.join('\n\n'),
  });
  return { text, sections };
}

/**
 * Warnings naming the pages read without text: drawn or scanned, with their text recognized or
 * not, or failed in pdf.js.
 */
function missingPages(
  pages: readonly (string | null)[],
  recognition: PageRecognition | undefined,
): string[] {
  const recognized = recognition?.pages;
  const numbers = (missing: (text: string | null, page: number) => boolean) =>
    pages.flatMap((text, index) => (missing(text, index + 1) ? [index + 1] : []));
  const read = numbers((_, page) => Boolean(recognized?.get(page)));
  const empty = numbers((_, page) => recognized?.get(page) === '');
  const blank = numbers((text, page) => text === '' && !recognized?.has(page));
  const failed = numbers((text) => text === null);
  const warnings: string[] = [];
  if (read.length)
    warnings.push(
      `${pageList(read)} ${agree(read, 'has', 'have')} no text layer (scanned or drawn); ${agree(read, 'its', 'their')} text below was recognized on this Mac (OCR) and can contain misreadings.`,
    );
  if (empty.length)
    warnings.push(
      `${pageList(empty)} ${agree(empty, 'has', 'have')} no text layer, and no text was recognized on ${agree(empty, 'it', 'them')}: ${agree(empty, 'it', 'they')} may hold only pictures or drawings, which are not included.`,
    );
  const stopped = recognition?.stopped ? `: text recognition ${recognition.stopped}` : '';
  if (blank.length && blank.length === pages.length)
    warnings.push(
      `No page has a text layer (scanned or drawn), so the content of the pages is not included${stopped}.`,
    );
  else if (blank.length)
    warnings.push(
      `${pageList(blank)} ${agree(blank, 'has', 'have')} no text layer (scanned or drawn), so ${agree(blank, 'its', 'their')} content is not included${stopped}.`,
    );
  if (failed.length)
    warnings.push(
      `${pageList(failed)} could not be read, so ${agree(failed, 'its', 'their')} content is not included.`,
    );
  return warnings;
}

/** `one` for a single page, `many` for several. */
function agree(pages: readonly number[], one: string, many: string): string {
  return pages.length === 1 ? one : many;
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
