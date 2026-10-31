import type { ExtractedFiles, ExtractedImage, ExtractedSheet } from './outputs.js';

/**
 * What the main thread asks of an extraction worker (extract.ts, worker.ts) and what it answers.
 * Labels come from the main side's format table (formats.ts), so the worker loads no more than
 * its extractor needs. `out` is the staging directory a document's files (pictures, whole sheets)
 * go into (outputs.ts); without it the extractor keeps none.
 */
export type ExtractJob =
  | { kind: 'docx' | 'pptx' | 'odp' | 'epub'; bytes: Uint8Array; label: string; out?: string }
  /** A workbook; `zipped` for formats SheetJS reads from a zip (xlsx, ods, numbers). */
  | { kind: 'sheet'; bytes: Uint8Array; label: string; zipped: boolean; out?: string }
  /** textutil's HTML of a document, turned into Markdown. */
  | { kind: 'html'; html: string; label: string; included: string }
  /** Plain text another tool read (macOS Spotlight), wrapped and headed. */
  | { kind: 'flat'; text: string; label: string; included: string; warnings: string[] };

/**
 * A document's loaded text with the files written beside it, a password the file needs, or why
 * extraction failed.
 */
export type ExtractOutcome =
  | { status: 'text'; text: string; files?: ExtractedFiles }
  | { status: 'protected' }
  | { status: 'failed'; reason: string; outputFailed?: true };

/**
 * A PDF's pages as pdf-text.ts reads them, for the file loader, which composes their text on the
 * main thread (pdf.ts), and the web reader (harness/web/pdf.ts).
 */
export interface PdfPagesJob {
  kind: 'pdf-pages';
  bytes: Uint8Array;
  maxPages: number;
  /** Stops reading further pages once the text read reaches this many characters. */
  maxChars?: number;
}

/** Every job a worker takes. */
export type WorkerJob = ExtractJob | PdfPagesJob;

/** A PDF's pages (null for a page that could not be read), or why there are none. */
export type PdfPagesReply =
  | { status: 'pages'; pageCount: number; pages: (string | null)[]; title: string }
  | { status: 'protected' }
  | { status: 'failed'; reason: string };

/** Longest failure reason a description repeats. */
const MAX_REASON = 200;

/** A thrown value as a short, single-line reason for a failed-extraction description. */
export function failureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const line = message.split('\n', 1)[0]?.replace(/\s+/g, ' ').trim().replace(/\.$/, '') ?? '';
  if (!line) return 'the file could not be parsed';
  return line.length > MAX_REASON ? `${line.slice(0, MAX_REASON)}…` : line;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

const UNEXPECTED = { status: 'failed', reason: 'the extractor sent an unexpected reply' } as const;

/** A worker's reply to an `ExtractJob`, checked at the thread boundary. */
export function parseOutcome(message: unknown): ExtractOutcome {
  const reply = record(message);
  if (reply?.status === 'text' && typeof reply.text === 'string') {
    if (reply.files === undefined) return { status: 'text', text: reply.text };
    const files = parseFiles(reply.files);
    return files ? { status: 'text', text: reply.text, files } : UNEXPECTED;
  }
  if (reply?.status === 'protected') return { status: 'protected' };
  if (reply?.status === 'failed' && typeof reply.reason === 'string') {
    if (reply.outputFailed !== undefined && reply.outputFailed !== true) return UNEXPECTED;
    return {
      status: 'failed',
      reason: reply.reason,
      ...(reply.outputFailed ? { outputFailed: true } : {}),
    };
  }
  return UNEXPECTED;
}

/** A worker's reply to a `PdfPagesJob`, checked at the thread boundary. */
export function parsePdfPagesReply(message: unknown): PdfPagesReply {
  const reply = record(message);
  if (reply?.status === 'protected') return { status: 'protected' };
  if (reply?.status === 'failed' && typeof reply.reason === 'string')
    return { status: 'failed', reason: reply.reason };
  const { pageCount, pages, title } = reply ?? {};
  if (
    reply?.status !== 'pages' ||
    typeof pageCount !== 'number' ||
    typeof title !== 'string' ||
    !Array.isArray(pages)
  )
    return UNEXPECTED;
  const read = pages.map((page: unknown) => (typeof page === 'string' ? page : null));
  return { status: 'pages', pageCount, pages: read, title };
}

/** A job as the worker receives it, checked at the thread boundary. */
export function parseJob(message: unknown): WorkerJob {
  const job = record(message);
  if (!job) throw new Error('the extraction job is malformed');
  const { kind, bytes, maxChars } = job;
  if (kind === 'pdf-pages' && bytes instanceof Uint8Array && typeof job.maxPages === 'number')
    return {
      kind,
      bytes,
      maxPages: job.maxPages,
      ...(typeof maxChars === 'number' ? { maxChars } : {}),
    };
  const label = typeof job.label === 'string' ? job.label : undefined;
  if (label === undefined) throw new Error('the extraction job is malformed');
  const out = typeof job.out === 'string' ? { out: job.out } : {};
  if (bytes instanceof Uint8Array) {
    if (kind === 'docx' || kind === 'pptx' || kind === 'odp' || kind === 'epub')
      return { kind, bytes, label, ...out };
    if (kind === 'sheet') return { kind, bytes, label, zipped: job.zipped === true, ...out };
  }
  const included = typeof job.included === 'string' ? job.included : '';
  if (kind === 'html' && typeof job.html === 'string')
    return { kind, html: job.html, label, included };
  if (kind === 'flat' && typeof job.text === 'string' && Array.isArray(job.warnings))
    return { kind, text: job.text, label, included, warnings: job.warnings.map(String) };
  throw new Error('the extraction job is malformed');
}

/** Paths an extraction may name in its entry (outputs.ts). */
const IMAGE_FILE = /^images\/\d{2,}\.[a-z]{3,4}$/;
const SHEET_FILE = /^sheets\/\d{2,}-[^/\\]*\.csv$/u;

/** The files a worker says it wrote, checked field by field; undefined when any is malformed. */
function parseFiles(value: unknown): ExtractedFiles | undefined {
  const files = record(value);
  const { images, sheets, omitted } = files ?? {};
  if (!Array.isArray(images) || !Array.isArray(sheets) || !Array.isArray(omitted)) return undefined;
  const parsedImages = images.map(parseImage);
  const parsedSheets = sheets.map(parseSheet);
  if (parsedImages.some((item) => !item) || parsedSheets.some((item) => !item)) return undefined;
  if (omitted.some((note) => typeof note !== 'string')) return undefined;
  return {
    images: parsedImages.filter((item) => item !== undefined),
    sheets: parsedSheets.filter((item) => item !== undefined),
    omitted: omitted.map(String),
  };
}

function parseImage(value: unknown): ExtractedImage | undefined {
  const image = record(value);
  if (!image) return undefined;
  const { file, mime, bytes, alt, where } = image;
  if (typeof file !== 'string' || !IMAGE_FILE.test(file)) return undefined;
  if (typeof mime !== 'string' || typeof bytes !== 'number' || typeof alt !== 'string')
    return undefined;
  if (!Array.isArray(where) || where.some((place) => typeof place !== 'string')) return undefined;
  return { file, mime, bytes, alt, where: where.map(String) };
}

function parseSheet(value: unknown): ExtractedSheet | undefined {
  const sheet = record(value);
  if (!sheet) return undefined;
  const { file, name, range, rows, columns, hidden } = sheet;
  if (typeof file !== 'string' || !SHEET_FILE.test(file)) return undefined;
  if (typeof name !== 'string' || typeof range !== 'string' || typeof hidden !== 'boolean')
    return undefined;
  if (typeof rows !== 'number' || typeof columns !== 'number') return undefined;
  return { file, name, range, rows, columns, hidden };
}
