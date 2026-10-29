/**
 * What the main thread asks of an extraction worker (extract.ts, worker.ts) and what it answers.
 * Labels come from the main side's format table (formats.ts), so the worker loads no more than
 * its extractor needs.
 */
export type ExtractJob =
  | { kind: 'pdf' | 'docx' | 'pptx' | 'odp' | 'epub'; bytes: Uint8Array; label: string }
  /** A workbook; `zipped` for formats SheetJS reads from a zip (xlsx, ods, numbers). */
  | { kind: 'sheet'; bytes: Uint8Array; label: string; zipped: boolean }
  /** textutil's HTML of a document, turned into Markdown. */
  | { kind: 'html'; html: string; label: string; included: string }
  /** Plain text another tool read (macOS Spotlight), wrapped and headed. */
  | { kind: 'flat'; text: string; label: string; included: string; warnings: string[] };

/** A document's loaded text, a password the file needs, or why extraction failed. */
export type ExtractOutcome =
  | { status: 'text'; text: string }
  | { status: 'protected' }
  | { status: 'failed'; reason: string };

/** The web reader's job (harness/web/pdf.ts): a PDF's pages as pdf-text.ts reads them. */
export interface PdfPagesJob {
  kind: 'pdf-pages';
  bytes: Uint8Array;
  maxPages: number;
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
  if (reply?.status === 'text' && typeof reply.text === 'string')
    return { status: 'text', text: reply.text };
  if (reply?.status === 'protected') return { status: 'protected' };
  if (reply?.status === 'failed' && typeof reply.reason === 'string')
    return { status: 'failed', reason: reply.reason };
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
  const { kind, bytes } = job;
  if (kind === 'pdf-pages' && bytes instanceof Uint8Array && typeof job.maxPages === 'number')
    return { kind, bytes, maxPages: job.maxPages };
  const label = typeof job.label === 'string' ? job.label : undefined;
  if (label === undefined) throw new Error('the extraction job is malformed');
  if (bytes instanceof Uint8Array) {
    if (kind === 'pdf' || kind === 'docx' || kind === 'pptx' || kind === 'odp' || kind === 'epub')
      return { kind, bytes, label };
    if (kind === 'sheet') return { kind, bytes, label, zipped: job.zipped === true };
  }
  const included = typeof job.included === 'string' ? job.included : '';
  if (kind === 'html' && typeof job.html === 'string')
    return { kind, html: job.html, label, included };
  if (kind === 'flat' && typeof job.text === 'string' && Array.isArray(job.warnings))
    return { kind, text: job.text, label, included, warnings: job.warnings.map(String) };
  throw new Error('the extraction job is malformed');
}
