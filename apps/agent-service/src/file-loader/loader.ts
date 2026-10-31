import { describeFailure, describeFile, describeProtected } from './describe.js';
import { capText } from './document.js';
import { workerExtract, workerPdfPages, type Extract, type ExtractPdfPages } from './extract.js';
import { formatHint, formatOf, type Format } from './formats.js';
import { IMAGE_HEADER_BYTES, oversizeNote } from './image-size.js';
import { failureReason, type ExtractOutcome } from './jobs.js';
import { decodedText, loadPath } from './load-path.js';
import { sipsJpeg, spotlightText, textutilHtml } from './macos-tools.js';
import type { ExtractedFiles } from './outputs.js';
import { recognizePages } from './pdf-ocr.js';
import { pdfDocument, PDF_LIMITS, type ReadLines } from './pdf.js';
import { runProcess, type RunProcess } from './process.js';
import { detect, type Detected } from './sniff.js';
import { decodeText, type DecodedText } from './text.js';
import type { ZipListing } from './zip.js';

/** A file's bytes; its name and stored media type are hints for what the content leaves open. */
export interface FileInput {
  bytes: Uint8Array;
  name?: string;
  mime?: string;
}

/**
 * What the model receives for a file: `utf8` when the file's own bytes are its text (valid UTF-8,
 * passed on as they are), `text` for decoded, extracted or descriptive text, `image` for image
 * input in a format the models or Pi take (`convertedFrom` names the format it was converted from).
 * A `text` is `failed` when it says why the file could not be extracted or converted
 * (describe.ts `describeFailure`): the cause may pass, such as a worker that timed out under load.
 * It has `readLines` when it may hold recognized text that `read`'s text of the file does not, and
 * `content` when its text is the file's own content rather than a description of the file.
 */
export type LoadedFile =
  | { kind: 'utf8'; bytes: Uint8Array }
  | {
      kind: 'text';
      text: string;
      failed?: true;
      /** Only output I/O failed; the store can retry without saving extracted files. */
      outputFailed?: true;
      readLines?: ReadLines;
      content?: TextContent;
    }
  | { kind: 'image'; mime: string; bytes: Uint8Array; convertedFrom?: string };

/**
 * What an extraction entry (extraction-store.ts) is made of when a `text` load is the file's own
 * content: a document's extracted text or a text file's decoded one, never a description, a
 * failure or a UTF-8 text file, whose own bytes grep reads.
 */
export interface TextContent {
  /** The format's label (formats.ts), which the entry's manifest names. */
  format: string;
  /** `read`'s text of the file, when the loaded text holds recognized pages that it does not. */
  readText?: string;
  /** The files the extraction wrote into the load's `out` directory, which its text names. */
  files?: ExtractedFiles;
  /** The directory of the entry that keeps the content, once the store holds one (load-cache.ts). */
  entry?: string;
}

/** The name and stored media type a file is known by, when its path does not carry them. */
export type FileHint = Pick<FileInput, 'name' | 'mime'>;

/**
 * Asks for the text of PDF pages without a text layer to be recognized on macOS (pdf-ocr.ts), as
 * far as the document's text reaches `tokens` estimated tokens: for the material of a run that
 * cannot run the file-loader skill's OCR script itself (tasks/run-budget.ts `recognize`).
 */
export interface Recognize {
  tokens: number;
}

/**
 * A load's abort signal, what it recognizes beyond what `read` loads, and the directory a
 * document's extraction writes its files into (`out` of the extraction job, outputs.ts), which
 * its text then names; without one the extraction keeps no files.
 */
export interface LoadFileOptions {
  signal?: AbortSignal;
  recognize?: Recognize;
  out?: string;
}

/**
 * Turns any file into model input, the same for an attachment and for `read`, so their text and
 * line numbers agree; only `recognize`, which `read` never asks for, adds text. It never rejects
 * for a bad file, whose text then says what failed; only an aborted `signal` or an unreadable path
 * rejects.
 */
export interface FileLoader {
  load(input: FileInput, options?: LoadFileOptions): Promise<LoadedFile>;
  /**
   * A file on disk, hinted by `hint` (a resource's stored name and type) or else by its path. One
   * over `MAX_ATTACHMENT_BYTES` is only read as far as its kind needs; an image passes whole
   * (load-path.ts).
   */
  loadPath(file: string, options?: { hint?: FileHint } & LoadFileOptions): Promise<LoadedFile>;
}

/** What the loader runs, injectable so other platforms and tests need no macOS tools or workers. */
export interface LoaderDeps {
  platform: NodeJS.Platform;
  run: RunProcess;
  extract: Extract;
  pdfPages: ExtractPdfPages;
}

const INCLUDED_TEXTUTIL =
  'text as Markdown with headings, lists and tables; images are not included';
const INCLUDED_SPOTLIGHT =
  'plain text as macOS Spotlight reads it; layout, tables and images are not included';

/** Exports that make a file readable when the loader can read little or none of it. */
const EXPORTS: Readonly<Record<string, string>> = {
  pages: 'PDF or Word',
  key: 'PDF or PowerPoint',
  numbers: 'Excel or CSV',
  ppt: 'PDF or a current PowerPoint (.pptx) file',
};

function advice(id: string): string[] {
  const exported = EXPORTS[id];
  return exported ? [`Its text can be read from an export to ${exported}.`] : [];
}

function text(value: string): LoadedFile {
  return { kind: 'text', text: value };
}

/** The description of a file whose extraction or conversion failed. */
function failure(value: string, outputFailed?: true): LoadedFile {
  return { kind: 'text', text: value, failed: true, ...(outputFailed ? { outputFailed } : {}) };
}

function zipOf(found: Detected): ZipListing | undefined {
  return 'zip' in found ? found.zip : undefined;
}

export function createFileLoader(overrides: Partial<LoaderDeps> = {}): FileLoader {
  const deps: LoaderDeps = {
    platform: process.platform,
    run: runProcess,
    extract: workerExtract(),
    pdfPages: workerPdfPages(),
    ...overrides,
  };
  const load = async (input: FileInput, options: LoadFileOptions = {}): Promise<LoadedFile> => {
    const { signal } = options;
    signal?.throwIfAborted();
    const found = detect(input.bytes, formatHint(input.name, input.mime));
    try {
      return await route(found, input.bytes, deps, options);
    } catch (error) {
      if (signal?.aborted) throw error;
      const reason = `could not extract its text: ${failureReason(error)}`;
      return failure(describeFailure(formatOf(found.id), reason, zipOf(found), advice(found.id)));
    }
  };
  return { load, loadPath: (file, options) => loadPath(file, load, options) };
}

/** The loader attachments and `read` share. */
export const fileLoader: FileLoader = createFileLoader();

async function route(
  found: Detected,
  bytes: Uint8Array,
  deps: LoaderDeps,
  { signal, recognize, out }: LoadFileOptions,
): Promise<LoadedFile> {
  const format = formatOf(found.id);
  const size = bytes.byteLength;
  const document = (outcome: ExtractOutcome) => fromOutcome(outcome, format, size, found);
  const macOS = deps.platform === 'darwin';
  // Where a document's pictures and whole sheets go, which its text then names (outputs.ts).
  const outputs = out === undefined ? {} : { out };
  switch (found.route) {
    case 'text':
      return loadText(bytes, found.id);
    case 'image':
      return imageInput(bytes, found.id, format, size);
    case 'convert':
      return macOS
        ? convertImage(bytes, found.id, format, deps, signal)
        : text(describeFile(format, size));
    case 'pdf': {
      const pdf = await deps.pdfPages(bytes, PDF_LIMITS, signal);
      // A text that mentions `%PDF-` near its start reads like a PDF there, and pdf.js fails on it.
      const decoded = pdf.status === 'failed' && found.prefixed ? decodeText(bytes) : null;
      if (decoded) return textInput(bytes, decoded, '');
      if (pdf.status !== 'pages') return document(pdf);
      // The OCR script tells a PDF by its first bytes, which a prefixed one does not start with.
      const recognition =
        recognize && macOS && !found.prefixed
          ? await recognizePages(bytes, pdf.pages, recognize.tokens, deps.run, signal)
          : undefined;
      const outcome = pdfDocument(pdf, format.label, recognition);
      if (outcome.status === 'failed') return document(outcome);
      const { readLines } = outcome;
      // The content an entry keeps is `read`'s text, which recognizes no page.
      const plain = readLines ? pdfDocument(pdf, format.label) : outcome;
      const content =
        plain.status === 'text'
          ? { format: format.label, ...(readLines ? { readText: plain.text } : {}) }
          : undefined;
      return {
        kind: 'text',
        text: outcome.text,
        ...(readLines ? { readLines } : {}),
        ...(content ? { content } : {}),
      };
    }
    case 'docx':
    case 'pptx':
    case 'odp':
    case 'epub': {
      const job = { kind: found.route, bytes, label: format.label, ...outputs };
      return document(await deps.extract(job, signal));
    }
    case 'sheet': {
      const job = {
        kind: 'sheet',
        bytes,
        label: format.label,
        zipped: found.zip !== undefined,
        ...outputs,
      } as const;
      const outcome = await deps.extract(job, signal);
      // A Pages document with a table has the parts of a Numbers one; Spotlight reads either.
      if (outcome.status === 'failed' && !outcome.outputFailed && found.id === 'numbers' && macOS)
        return spotlightDocument(bytes, found, deps, signal);
      return document(outcome);
    }
    case 'textutil': {
      if (!macOS) return text(describeFile(format, size, found.zip));
      const html = await textutilHtml(bytes, found.format, deps.run, signal);
      const job = { kind: 'html', html, label: format.label, included: INCLUDED_TEXTUTIL } as const;
      return document(await deps.extract(job, signal));
    }
    case 'spotlight':
      if (!macOS) return text(describeFile(format, size, found.zip, advice(found.id)));
      return spotlightDocument(bytes, found, deps, signal);
    case 'protected':
      return text(describeProtected(format, size));
    case 'archive':
    case 'binary':
      return text(describeFile(format, size, found.zip, advice(found.id)));
  }
}

/** The plain text macOS Spotlight reads from a file, wrapped and headed in a worker. */
async function spotlightDocument(
  bytes: Uint8Array,
  found: Detected,
  deps: LoaderDeps,
  signal?: AbortSignal,
): Promise<LoadedFile> {
  const format = formatOf(found.id);
  const flat = await spotlightText(bytes, found.id, deps.run, signal);
  const exported = EXPORTS[found.id];
  const warnings = exported
    ? [`An export to ${exported} keeps the layout and tables this text loses.`]
    : [];
  const job = {
    kind: 'flat',
    text: flat,
    label: format.label,
    included: INCLUDED_SPOTLIGHT,
    warnings,
  } as const;
  return fromOutcome(await deps.extract(job, signal), format, bytes.byteLength, found);
}

function fromOutcome(
  outcome: ExtractOutcome,
  format: Format,
  size: number,
  found: Detected,
): LoadedFile {
  switch (outcome.status) {
    case 'text': {
      const { files } = outcome;
      const content = { format: format.label, ...(files ? { files } : {}) };
      return { kind: 'text', text: outcome.text, content };
    }
    case 'protected':
      return text(describeProtected(format, size));
    case 'failed':
      return failure(
        describeFailure(
          format,
          `could not extract its text: ${outcome.reason}`,
          zipOf(found),
          advice(found.id),
        ),
        outcome.outputFailed,
      );
  }
}

/** A file of format `id` read as text, or described when its bytes turn out binary. */
function loadText(bytes: Uint8Array, id: string): LoadedFile {
  const decoded = decodeText(bytes);
  if (decoded) return textInput(bytes, decoded, id);
  return text(describeFile(formatOf(id), bytes.byteLength));
}

/** A text file's own bytes when they are UTF-8 text, else its decoded text (load-path.ts). */
function textInput(bytes: Uint8Array, decoded: DecodedText, id: string): LoadedFile {
  return decoded.utf8 ? { kind: 'utf8', bytes } : decodedText(capText(decoded.text), id);
}

/** An image as it is, or its description when its header declares too many pixels to scale. */
function imageInput(bytes: Uint8Array, id: string, format: Format, size: number): LoadedFile {
  const oversize = oversizeNote(id, bytes.subarray(0, IMAGE_HEADER_BYTES));
  if (oversize) return text(describeFile(format, size, undefined, [oversize]));
  return { kind: 'image', mime: format.mime, bytes };
}

/** An image models do not take, converted to a JPEG of the same size. */
async function convertImage(
  bytes: Uint8Array,
  id: string,
  format: Format,
  deps: LoaderDeps,
  signal?: AbortSignal,
): Promise<LoadedFile> {
  let jpeg: Uint8Array;
  try {
    jpeg = await sipsJpeg(bytes, id, deps.run, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    return failure(
      describeFailure(format, `could not convert it for image input: ${failureReason(error)}`),
    );
  }
  const oversize = oversizeNote('jpeg', jpeg.subarray(0, IMAGE_HEADER_BYTES));
  if (oversize) return text(describeFile(format, bytes.byteLength, undefined, [oversize]));
  return { kind: 'image', mime: 'image/jpeg', bytes: jpeg, convertedFrom: id.toUpperCase() };
}
