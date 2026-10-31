import { isUtf8 } from 'node:buffer';
import type { Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { completeUtf8Length } from './text.js';

/**
 * Most bytes between the line starts an index records: any line start lies less than this past
 * the recorded one before it, so finding a line reads no more than this.
 */
const MARK_BYTES = 64 * 1024;
/** Bytes read at a time while indexing. */
const SCAN_BYTES = 1024 * 1024;
/** Indexes kept for files read again, the least recently used dropped first. */
const KEPT_INDEXES = 16;

const NEWLINE = 0x0a;

/**
 * Where the lines of a UTF-8 text file are, found in one pass over it. A final line break ends
 * the last line rather than starting an empty one, as `read` counts the lines of every file: a
 * file of N lines that each end in a break has N lines.
 */
export interface LineIndex {
  /** Where the text starts: 3 after a UTF-8 BOM, else 0. */
  start: number;
  /** Where the text ends: the file's size, less a final line break. */
  end: number;
  lines: number;
  /** Whether the last line is empty, the text ending in a line break of its own. */
  lastBlank: boolean;
  /** Whether the whole text is valid UTF-8. */
  utf8: boolean;
  /** Recorded line numbers (0-based, ascending, from 0) and the offsets those lines start at. */
  markLines: number[];
  markBytes: number[];
}

/** Bytes of a text from where one of its lines starts. */
export interface LineBytes {
  start: number;
  bytes: Buffer;
}

const kept = new Map<string, LineIndex>();

/** The key of a file's version: a rewrite changes its size or times, ctime even when mtime is restored. */
export function versionKey(real: string, info: Stats): string {
  return [real, info.size, info.mtimeMs, info.ctimeMs].join('\0');
}

/** The index kept for a file version, if it was indexed before and not dropped since. */
export function keptIndex(key: string): LineIndex | undefined {
  const index = kept.get(key);
  if (index) {
    kept.delete(key);
    kept.set(key, index);
  }
  return index;
}

export function keepIndex(key: string, index: LineIndex): void {
  kept.delete(key);
  kept.set(key, index);
  for (const oldest of kept.keys()) {
    if (kept.size <= KEPT_INDEXES) break;
    kept.delete(oldest);
  }
}

/**
 * Indexes the text from `start` to `size` of an open file, `SCAN_BYTES` at a time, so memory
 * stays flat whatever its size; checks `signal` before every read. A file that shrinks meanwhile
 * is indexed as far as it still reaches.
 */
export async function indexLines(
  handle: FileHandle,
  size: number,
  start: number,
  signal?: AbortSignal,
): Promise<LineIndex> {
  // The spare bytes hold a UTF-8 sequence one read cut, ahead of the next read's bytes.
  const buffer = Buffer.allocUnsafe(SCAN_BYTES + 4);
  const markLines = [0];
  const markBytes = [start];
  let mark = start;
  let line = 0;
  let lineStart = start;
  let previousStart = start;
  let carry = 0;
  let utf8 = true;
  let position = start;
  while (position < size) {
    signal?.throwIfAborted();
    const length = Math.min(SCAN_BYTES, size - position);
    const { bytesRead } = await handle.read(buffer, carry, length, position);
    if (bytesRead === 0) break;
    const data = buffer.subarray(0, carry + bytesRead);
    const base = position - carry;
    // The carried bytes belong to a multi-byte sequence, so none of them is a line break.
    for (let at = data.indexOf(NEWLINE, carry); at !== -1; at = data.indexOf(NEWLINE, at + 1)) {
      previousStart = lineStart;
      lineStart = base + at + 1;
      line += 1;
      if (lineStart - mark >= MARK_BYTES) {
        markLines.push(line);
        markBytes.push(lineStart);
        mark = lineStart;
      }
    }
    position += bytesRead;
    const whole = position < size ? completeUtf8Length(data) : data.length;
    utf8 &&= isUtf8(data.subarray(0, whole));
    carry = data.length - whole;
    data.copyWithin(0, whole);
  }
  // A sequence still carried when the file ended early is cut short.
  if (carry > 0) utf8 = false;
  const ended = position > start && lineStart === position;
  const end = ended ? position - 1 : position;
  const lines = ended ? line : line + 1;
  while (markLines.length > 1 && (markLines.at(-1) ?? 0) >= lines) {
    markLines.pop();
    markBytes.pop();
  }
  const lastBlank = ended && previousStart === end;
  return { start, end, lines, lastBlank, utf8, markLines, markBytes };
}

/**
 * Where line `line` (0-based, below `index.lines`) starts and up to `length` bytes of the text
 * from there, read from the recorded line start before it in a single read.
 */
export async function lineAt(
  handle: FileHandle,
  index: LineIndex,
  line: number,
  length: number,
): Promise<LineBytes> {
  const mark = markBefore(index.markLines, line);
  const markLine = index.markLines[mark] ?? 0;
  const markByte = index.markBytes[mark] ?? index.start;
  const bytes = await readRange(
    handle,
    markByte,
    Math.min(MARK_BYTES + length, index.end - markByte),
  );
  let at = 0;
  for (let skip = line - markLine; skip > 0; skip -= 1) {
    const found = bytes.indexOf(NEWLINE, at);
    // The index names line starts this file no longer has.
    if (found === -1) throw new Error('The file changed while it was being read. Read it again.');
    at = found + 1;
  }
  return { start: markByte + at, bytes: bytes.subarray(at, Math.min(at + length, bytes.length)) };
}

/** Up to `length` bytes of an open file from `position`, fewer where the file ends. */
export async function readRange(
  handle: FileHandle,
  position: number,
  length: number,
): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(Math.max(0, length));
  let filled = 0;
  while (filled < bytes.length) {
    const { bytesRead } = await handle.read(
      bytes,
      filled,
      bytes.length - filled,
      position + filled,
    );
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return bytes.subarray(0, filled);
}

/** The position of the last recorded line at or before `line`. */
function markBefore(markLines: readonly number[], line: number): number {
  let low = 0;
  let high = markLines.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((markLines[middle] ?? 0) <= line) low = middle;
    else high = middle - 1;
  }
  return low;
}
