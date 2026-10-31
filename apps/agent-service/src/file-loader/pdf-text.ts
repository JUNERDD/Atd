import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { getDocumentProxy } from 'unpdf';
import type { PdfPagesReply } from './jobs.js';

/**
 * pdf.js's binary CMaps, vendored from `cmaps/` of pdfjs-dist 6.4.299, the pdf.js unpdf 1.9.0
 * bundles (Adobe's BSD-3-Clause license in its LICENSE). Text set in CJK fonts that use a
 * predefined CMap reads only with them. Both `src/file-loader/` and `dist/file-loader/` resolve to
 * the package's `vendor/` (package.json `files`). A plain path with a trailing separator: pdf.js in
 * Node reads `${cMapUrl}${name}.bcmap` with `fs.readFile`, which takes no `file:` URL string.
 */
const CMAP_DIR = `${path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'vendor', 'pdfjs-cmaps')}${path.sep}`;

/** The text of a PDF's first pages. */
export interface PdfText {
  /** Pages the document has. */
  pageCount: number;
  /**
   * The text of each page read, from page 1: '' for a page without a text layer, null for a page
   * pdf.js failed on.
   */
  pages: (string | null)[];
  /** The title in the document's metadata, '' when it has none or it cannot be read. */
  title: string;
}

export interface PdfTextOptions {
  maxPages: number;
  /** Stops reading further pages once the text read reaches this many characters. */
  maxChars?: number;
}

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

/**
 * Reads a PDF's text page by page through unpdf's pdf.js: the single PDF text core of the file
 * loader (loader.ts) and the web reader (harness/web/pdf.ts), both in an extraction worker. Each
 * page is released after its text is read and the document when done; a page or the metadata
 * pdf.js fails on is skipped rather than failing the document. A password-protected PDF rejects
 * with pdf.js's `PasswordException` (`isPdfPasswordError`).
 */
export async function readPdfText(bytes: Uint8Array, options: PdfTextOptions): Promise<PdfText> {
  const { getDocumentProxy, getResolvedPDFJS } = await import('unpdf');
  const { VerbosityLevel } = await getResolvedPDFJS();
  const pdf = await getDocumentProxy(bytes, {
    // Warnings about malformed PDFs stay off the service log.
    verbosity: VerbosityLevel.ERRORS,
    cMapUrl: CMAP_DIR,
    cMapPacked: true,
    disableFontFace: true,
    // Text extraction draws nothing: no image needs decoding.
    maxImageSize: 0,
  });
  try {
    const title = await documentTitle(pdf);
    const count = Math.min(pdf.numPages, options.maxPages);
    const pages: (string | null)[] = [];
    let chars = 0;
    for (let number = 1; number <= count; number++) {
      if (options.maxChars !== undefined && chars >= options.maxChars) break;
      const text = await readPage(pdf, number);
      pages.push(text);
      chars += text?.length ?? 0;
    }
    return { pageCount: pdf.numPages, pages, title };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/** The pages job (worker.ts): a PDF's pages, or why there are none. */
export async function pdfPages(bytes: Uint8Array, options: PdfTextOptions): Promise<PdfPagesReply> {
  try {
    return { status: 'pages', ...(await readPdfText(bytes, options)) };
  } catch (error) {
    if (isPdfPasswordError(error)) return { status: 'protected' };
    throw error;
  }
}

async function readPage(pdf: PdfDocument, number: number): Promise<string | null> {
  try {
    const page = await pdf.getPage(number);
    try {
      return pageText((await page.getTextContent()).items);
    } finally {
      page.cleanup();
    }
  } catch {
    return null;
  }
}

async function documentTitle(pdf: PdfDocument): Promise<string> {
  try {
    return metadataTitle((await pdf.getMetadata()).info);
  } catch {
    return '';
  }
}

/** Whether pdf.js refused a document for want of its password. */
export function isPdfPasswordError(error: unknown): boolean {
  return error instanceof Error && error.name === 'PasswordException';
}

function textItem(item: unknown): { str: string; hasEOL: boolean } {
  if (typeof item !== 'object' || item === null) return { str: '', hasEOL: false };
  const { str, hasEOL } = item as Record<string, unknown>;
  return { str: typeof str === 'string' ? str : '', hasEOL: hasEOL === true };
}

/**
 * Simplified-form CJK radicals paired with the character each stands for, which Unicode gives no
 * decomposition. PDFs made on macOS map some ideographs to radicals in their ToUnicode tables
 * (`收⼊增⻓` for 收入增长); Kangxi radicals turn back by NFKC, these by this table.
 */
const SIMPLIFIED_RADICALS = new Map(
  [
    ...'⻅见⻆角⻉贝⻋车⻓长⻔门⻙韦⻚页⻛风⻜飞⻢马⻥鱼⻦鸟⻧卤⻨麦⻩黄⻪黾⻬齐⻮齿⻰龙'.matchAll(
      /(.)(.)/gu,
    ),
  ].map(([, radical = '', ideograph = '']) => [radical, ideograph]),
);

function ideographs(text: string): string {
  return text.replace(
    /[\u2e80-\u2fdf]/g,
    (radical) => SIMPLIFIED_RADICALS.get(radical) ?? radical.normalize('NFKC'),
  );
}

/** One page's text, keeping the line breaks pdf.js reports so headings and rows stay apart. */
function pageText(items: readonly unknown[]): string {
  const text = items
    .map((item) => {
      const { str, hasEOL } = textItem(item);
      return hasEOL ? `${str}\n` : str;
    })
    .join('');
  return ideographs(text)
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function metadataTitle(info: unknown): string {
  if (typeof info !== 'object' || info === null) return '';
  const { Title } = info as Record<string, unknown>;
  return typeof Title === 'string' ? Title : '';
}
