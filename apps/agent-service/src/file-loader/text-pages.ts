import { open, type FileHandle } from 'node:fs/promises';
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  type ReadToolDetails,
  type ReadToolInput,
  type TruncationResult,
} from '@earendil-works/pi-coding-agent';
import { MAX_ATTACHMENT_BYTES } from '@atd/agent-contracts';
import { formatHint } from './formats.js';
import { IMAGE_HEADER_BYTES } from './image-size.js';
import {
  indexLines,
  keepIndex,
  keptIndex,
  lineAt,
  readRange,
  versionKey,
  type LineBytes,
  type LineIndex,
} from './line-index.js';
import type { FileHint } from './loader.js';
import { detect } from './sniff.js';
import { utf8TextStart } from './text.js';

/**
 * UTF-8 text files larger than this are paged from byte ranges; smaller ones, nearly every source
 * file and document, are read whole, as pi's read tool reads every file. A whole read costs each
 * page in proportion to the file, so paging through all of it costs the square: at this size a
 * page takes about 4 ms and 8 MB and the whole file 25 ms; at 4 MB, 15 ms and 20 MB a page and
 * 350 ms in all; at 64 MB, up to 250 ms and 300 MB a page; at 300 MB, about a second and a
 * gigabyte; and past about 512 MB Node cannot hold the text at all. A paged read takes about a
 * millisecond and a few hundred KB whatever the size, once the file is indexed (about half a
 * millisecond a megabyte); below this size the two cost the same.
 */
export const PAGED_TEXT_BYTES = 1024 * 1024;

/** The part of a file a `read` call asks for. */
export type PageRequest = Pick<ReadToolInput, 'offset' | 'limit'>;

/** A page of text as pi's read tool returns it, with its cut when it was cut. */
export interface TextPage {
  text: string;
  details: ReadToolDetails | undefined;
}

/**
 * A page of a large UTF-8 text file, read from byte ranges through the file's line index: the
 * same lines, notes and errors pi's read gives for the whole text (`readFile` in read-tool.ts
 * hands it the text without a final line break, so both count lines alike). Null when the file's
 * loaded text is not its own UTF-8 bytes (after a BOM, which decoding drops), so the caller reads
 * it the ordinary way. `real` is the confined real path; `signal` stops the indexing between reads.
 */
export async function largeTextPage(
  real: string,
  hint: FileHint | undefined,
  request: PageRequest,
  signal?: AbortSignal,
): Promise<TextPage | null> {
  const handle = await open(real, 'r');
  try {
    const info = await handle.stat();
    const key = versionKey(real, info);
    let index = keptIndex(key);
    if (!index) {
      const start = await textStart(handle, real, hint);
      if (start === null) return null;
      index = await indexLines(handle, info.size, start, signal);
      keepIndex(key, index);
    }
    // Up to the size the loader reads whole, text that is not UTF-8 throughout is decoded as the
    // loader decodes it; past that size the loader passes the bytes on, decoded as pi decodes them.
    if (!index.utf8 && info.size <= MAX_ATTACHMENT_BYTES) return null;
    signal?.throwIfAborted();
    return await page(handle, index, request);
  } finally {
    await handle.close();
  }
}

/** Where the text starts in a file whose loaded text is its own UTF-8 bytes, else null. */
async function textStart(
  handle: FileHandle,
  real: string,
  hint: FileHint | undefined,
): Promise<number | null> {
  const head = await readRange(handle, 0, IMAGE_HEADER_BYTES);
  if (detect(head, formatHint(hint?.name ?? real, hint?.mime)).route !== 'text') return null;
  return utf8TextStart(head);
}

/**
 * pi's text branch (dist/core/tools/read.js) over the index: its arithmetic, notes and error. The
 * line just after the last is an empty page, as read-tool.ts has pi page it for a smaller file.
 */
async function page(
  handle: FileHandle,
  index: LineIndex,
  { offset, limit }: PageRequest,
): Promise<TextPage> {
  const total = index.lines;
  const startLine = offset ? Math.max(0, offset - 1) : 0;
  const startLineDisplay = startLine + 1;
  if (startLine > total)
    throw new Error(`Offset ${offset} is beyond end of file (${total} lines total)`);
  if (startLine === total) return { text: '', details: undefined };
  const endLine = limit === undefined ? total : Math.min(startLine + limit, total);
  const first = sliceIndex(startLine, total);
  const end = sliceIndex(endLine, total);
  // One byte past the limit shows whether the lines it holds fit within it.
  const window = await lineAt(handle, index, first, DEFAULT_MAX_BYTES + 1);
  const truncation = await truncateLines(handle, index, window, first, end);
  if (truncation.firstLineExceedsLimit) {
    const more = first + 1 < total;
    const next = more ? (await lineAt(handle, index, first + 1, 0)).start - 1 : index.end;
    const line = { display: startLineDisplay, size: next - window.start, more, searchable: true };
    return { text: longLineText(window.bytes, line), details: { truncation } };
  }
  if (truncation.truncated) {
    const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
    const limitNote =
      truncation.truncatedBy === 'lines' ? '' : ` (${formatSize(DEFAULT_MAX_BYTES)} limit)`;
    const note = `[Showing lines ${startLineDisplay}-${endLineDisplay} of ${total}${limitNote}. Use offset=${endLineDisplay + 1} to continue.]`;
    return { text: `${truncation.content}\n\n${note}`, details: { truncation } };
  }
  const userLimitedLines = limit === undefined ? undefined : endLine - startLine;
  if (userLimitedLines !== undefined && startLine + userLimitedLines < total) {
    const remaining = total - (startLine + userLimitedLines);
    const note = `[${remaining} more lines in file. Use offset=${startLine + userLimitedLines + 1} to continue.]`;
    return { text: `${truncation.content}\n\n${note}`, details: undefined };
  }
  return { text: truncation.content, details: undefined };
}

/**
 * pi's `truncateHead` of lines `first` to `end`, from the window at the first: exactly
 * `truncateHead` of their text when the window holds them all; otherwise they pass the byte limit,
 * and its loop runs over the lines the window holds, the line running past it too long to fit.
 */
async function truncateLines(
  handle: FileHandle,
  index: LineIndex,
  window: LineBytes,
  first: number,
  end: number,
): Promise<TruncationResult> {
  const count = Math.max(0, end - first);
  if (count === 0) return truncateHead('');
  const known = wholeLines(window, index);
  if (known.length >= count) return truncateHead(known.slice(0, count).join('\n'));
  const totals = await selectionTotals(handle, index, window.start, first, end);
  const cut = {
    truncated: true,
    totalLines: totals.lines,
    totalBytes: totals.bytes,
    lastLinePartial: false,
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  } as const;
  const head = known[0];
  if (head === undefined || Buffer.byteLength(head, 'utf8') > DEFAULT_MAX_BYTES) {
    const shown = { content: '', outputLines: 0, outputBytes: 0 };
    return { ...cut, ...shown, truncatedBy: 'bytes', firstLineExceedsLimit: true };
  }
  const lines: string[] = [];
  let bytes = 0;
  let truncatedBy: 'lines' | 'bytes' = 'lines';
  for (let at = 0; at < totals.lines && at < DEFAULT_MAX_LINES; at += 1) {
    // A line the window does not hold runs past it, so past the limit.
    const line = known[at];
    const lineBytes = line === undefined ? 0 : Buffer.byteLength(line, 'utf8') + (at > 0 ? 1 : 0);
    if (line === undefined || bytes + lineBytes > DEFAULT_MAX_BYTES) {
      truncatedBy = 'bytes';
      break;
    }
    lines.push(line);
    bytes += lineBytes;
  }
  if (lines.length >= DEFAULT_MAX_LINES && bytes <= DEFAULT_MAX_BYTES) truncatedBy = 'lines';
  const content = lines.join('\n');
  const shown = { content, outputLines: lines.length, outputBytes: Buffer.byteLength(content) };
  return { ...cut, ...shown, truncatedBy, firstLineExceedsLimit: false };
}

/** The lines that end within the window, decoded: all of them once it reaches the text's end. */
function wholeLines({ start, bytes }: LineBytes, index: LineIndex): string[] {
  if (start + bytes.length >= index.end) return bytes.toString('utf8').split('\n');
  const last = bytes.lastIndexOf(0x0a);
  return last === -1 ? [] : bytes.subarray(0, last).toString('utf8').split('\n');
}

/**
 * The line and byte counts `truncateHead` reports for lines `first` to `end`, which run past the
 * window: it does not count an empty last line after a line break.
 */
async function selectionTotals(
  handle: FileHandle,
  index: LineIndex,
  firstStart: number,
  first: number,
  end: number,
): Promise<{ lines: number; bytes: number }> {
  const count = end - first;
  if (end === index.lines)
    return { lines: count - (count > 1 && index.lastBlank ? 1 : 0), bytes: index.end - firstStart };
  const next = await lineAt(handle, index, end, 0);
  const last = await lineAt(handle, index, end - 1, 1);
  const blank = count > 1 && last.bytes[0] === 0x0a;
  return { lines: count - (blank ? 1 : 0), bytes: next.start - 1 - firstStart };
}

/** Where `Array.prototype.slice` puts a bound `value` in a list of `length`. */
function sliceIndex(value: number, length: number): number {
  const whole = Math.trunc(value) || 0;
  return whole < 0 ? Math.max(length + whole, 0) : Math.min(whole, length);
}

/** A line too long for a page: its 1-based number as the page counts, and its size in bytes. */
export interface LongLine {
  display: number;
  size: number;
  /** Whether more lines follow it. */
  more: boolean;
  /** Whether the file is a text file, whose text grep finds; a document's extracted text is not. */
  searchable: boolean;
}

/**
 * The page for a line longer than the byte limit, of which pi's read shows nothing but a bash
 * command: the line's first `DEFAULT_MAX_BYTES` from `bytes` (its start), cut between
 * characters, then a note on its size, why read cannot show the rest, and where paging goes on.
 */
export function longLineText(bytes: Uint8Array, line: LongLine): string {
  let cut = Math.min(DEFAULT_MAX_BYTES, bytes.length);
  // UTF-8 continuation bytes (10xxxxxx) do not start a character.
  while (cut > 0 && cut < bytes.length && ((bytes[cut] ?? 0) & 0xc0) === 0x80) cut -= 1;
  const shown = Buffer.from(bytes.buffer, bytes.byteOffset, cut).toString('utf8');
  const rest = line.searchable
    ? 'grep finds text anywhere in it'
    : 'converted text cannot be searched with grep either';
  const next = line.more ? ` Use offset=${line.display + 1} to continue.` : '';
  return `${shown}\n\n[Line ${line.display} is ${formatSize(line.size)}, over the ${formatSize(DEFAULT_MAX_BYTES)} limit; this shows its first ${formatSize(cut)}. read cannot page within a line, and ${rest}.${next}]`;
}
