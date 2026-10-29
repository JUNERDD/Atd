import { open, readFile, stat } from 'node:fs/promises';
import { MAX_ATTACHMENT_BYTES } from '@atd/agent-contracts';
import { describeFailure, describeFile, describeProtected } from './describe.js';
import { capText } from './document.js';
import { workerExtract, type Extract } from './extract.js';
import { formatHint, formatOf, type Format } from './formats.js';
import { IMAGE_HEADER_BYTES, oversizeNote } from './image-size.js';
import { failureReason, type ExtractOutcome } from './jobs.js';
import { sipsJpeg, spotlightText, textutilHtml } from './macos-tools.js';
import { runProcess, type RunProcess } from './process.js';
import { detect, type Detected } from './sniff.js';
import { decodeText, startsAsUtf8Text, TEXT_SAMPLE_BYTES, type DecodedText } from './text.js';
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
 */
export type LoadedFile =
  | { kind: 'utf8'; bytes: Uint8Array }
  | { kind: 'text'; text: string }
  | { kind: 'image'; mime: string; bytes: Uint8Array; convertedFrom?: string };

/** The name and stored media type a file is known by, when its path does not carry them. */
export type FileHint = Pick<FileInput, 'name' | 'mime'>;

/**
 * Turns any file into model input, the same for an attachment and for `read`, so their text and
 * line numbers agree. It never rejects for a bad file, whose text then says what failed; only an
 * aborted `signal` or an unreadable path rejects.
 */
export interface FileLoader {
  load(input: FileInput, signal?: AbortSignal): Promise<LoadedFile>;
  /**
   * A file on disk, hinted by `hint` (a resource's stored name and type) or else by its path. One
   * over `MAX_ATTACHMENT_BYTES` is only read as far as its kind needs; an image passes whole.
   */
  loadPath(file: string, options?: { hint?: FileHint; signal?: AbortSignal }): Promise<LoadedFile>;
}

/** What the loader runs, injectable so other platforms and tests need no macOS tools or workers. */
export interface LoaderDeps {
  platform: NodeJS.Platform;
  run: RunProcess;
  extract: Extract;
}

const MIB = 1024 * 1024;
/** The prefix of a large text file in another encoding that is decoded: past `capText`'s limit in any encoding. */
const LARGE_TEXT_PREFIX_BYTES = 32 * MIB;

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

function zipOf(found: Detected): ZipListing | undefined {
  return 'zip' in found ? found.zip : undefined;
}

export function createFileLoader(overrides: Partial<LoaderDeps> = {}): FileLoader {
  const deps: LoaderDeps = {
    platform: process.platform,
    run: runProcess,
    extract: workerExtract(),
    ...overrides,
  };
  const load = async (input: FileInput, signal?: AbortSignal): Promise<LoadedFile> => {
    signal?.throwIfAborted();
    const found = detect(input.bytes, formatHint(input.name, input.mime));
    try {
      return await route(found, input.bytes, deps, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      const failure = `could not extract its text: ${failureReason(error)}`;
      return text(describeFailure(formatOf(found.id), failure, zipOf(found), advice(found.id)));
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
  signal?: AbortSignal,
): Promise<LoadedFile> {
  const format = formatOf(found.id);
  const size = bytes.byteLength;
  const document = (outcome: ExtractOutcome) => fromOutcome(outcome, format, size, found);
  const macOS = deps.platform === 'darwin';
  switch (found.route) {
    case 'text':
      return loadText(bytes, format);
    case 'image':
      return imageInput(bytes, found.id, format, size);
    case 'convert':
      return macOS
        ? convertImage(bytes, found.id, format, deps, signal)
        : text(describeFile(format, size));
    case 'pdf': {
      const outcome = await deps.extract({ kind: 'pdf', bytes, label: format.label }, signal);
      // A text that mentions `%PDF-` near its start reads like a PDF there, and pdf.js fails on it.
      const decoded = outcome.status === 'failed' && found.prefixed ? decodeText(bytes) : null;
      return decoded ? textInput(bytes, decoded) : document(outcome);
    }
    case 'docx':
    case 'pptx':
    case 'odp':
    case 'epub':
      return document(
        await deps.extract({ kind: found.route, bytes, label: format.label }, signal),
      );
    case 'sheet': {
      const job = {
        kind: 'sheet',
        bytes,
        label: format.label,
        zipped: found.zip !== undefined,
      } as const;
      const outcome = await deps.extract(job, signal);
      // A Pages document with a table has the parts of a Numbers one; Spotlight reads either.
      if (outcome.status === 'failed' && found.id === 'numbers' && macOS)
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
    case 'text':
      return text(outcome.text);
    case 'protected':
      return text(describeProtected(format, size));
    case 'failed':
      return text(
        describeFailure(
          format,
          `could not extract its text: ${outcome.reason}`,
          zipOf(found),
          advice(found.id),
        ),
      );
  }
}

function loadText(bytes: Uint8Array, format: Format): LoadedFile {
  const decoded = decodeText(bytes);
  return decoded ? textInput(bytes, decoded) : text(describeFile(format, bytes.byteLength));
}

function textInput(bytes: Uint8Array, decoded: DecodedText): LoadedFile {
  return decoded.utf8 ? { kind: 'utf8', bytes } : text(capText(decoded.text));
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
    return text(
      describeFailure(format, `could not convert it for image input: ${failureReason(error)}`),
    );
  }
  const oversize = oversizeNote('jpeg', jpeg.subarray(0, IMAGE_HEADER_BYTES));
  if (oversize) return text(describeFile(format, bytes.byteLength, undefined, [oversize]));
  return { kind: 'image', mime: 'image/jpeg', bytes: jpeg, convertedFrom: id.toUpperCase() };
}

/**
 * Loads a file on disk. One past `MAX_ATTACHMENT_BYTES` is sniffed by its start: an image passes
 * whole as image input, UTF-8 text passes through whole (as `read` always read it), text in
 * another encoding is decoded from a prefix and cut, and anything else is described without being
 * parsed.
 */
async function loadPath(
  file: string,
  load: FileLoader['load'],
  { hint, signal }: { hint?: FileHint; signal?: AbortSignal } = {},
): Promise<LoadedFile> {
  const name = hint?.name ?? file;
  const { size } = await stat(file);
  if (size <= MAX_ATTACHMENT_BYTES) {
    const bytes = await readFile(file);
    return load({ bytes, name, ...(hint?.mime === undefined ? {} : { mime: hint.mime }) }, signal);
  }
  const head = await readStart(file, IMAGE_HEADER_BYTES);
  const found = detect(head, formatHint(name, hint?.mime));
  const format = formatOf(found.id);
  if (found.route === 'image') {
    const oversize = oversizeNote(found.id, head);
    if (oversize) return text(describeFile(format, size, undefined, [oversize]));
    return { kind: 'image', mime: format.mime, bytes: await readFile(file) };
  }
  if (found.route === 'text') {
    if (startsAsUtf8Text(head.subarray(0, TEXT_SAMPLE_BYTES)))
      return { kind: 'utf8', bytes: await readFile(file) };
    const prefix = await readStart(file, LARGE_TEXT_PREFIX_BYTES);
    const decoded = decodeText(prefix);
    if (decoded)
      return text(capText(decoded.utf8 ? Buffer.from(prefix).toString('utf8') : decoded.text));
  }
  const note = `Files over ${MAX_ATTACHMENT_BYTES / MIB} MB are not converted.`;
  return text(describeFile(format, size, undefined, [note]));
}

/** The first `length` bytes of a file, or all of a shorter one. */
export async function readStart(file: string, length: number): Promise<Uint8Array> {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
