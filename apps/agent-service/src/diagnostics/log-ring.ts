/**
 * Bounded in-memory log ring for agent-service diagnostics (`<= 500` lines and
 * `<= 512 KiB` UTF-8 bytes). Overlong or non-JSON lines are scalar-safely
 * truncated and wrapped as flat, valid single-line JSON without retaining
 * V8 SlicedString references to large parent buffers.
 */

export type LogRingLevel = 'debug' | 'info' | 'warn' | 'error';

export const SERVICE_LOG_RING_MAX_ENTRIES = 500;
export const SERVICE_LOG_RING_MAX_BYTES = 524_288;
export const SERVICE_LOG_LINE_MAX_BYTES = 4096;

const TRUNCATION_SUFFIX = '…[truncated:4KiB]';
const INITIAL_PREVIEW_CUT_BYTES = 3800;

export interface BoundedLogRingSnapshot {
  maxBytes: typeof SERVICE_LOG_RING_MAX_BYTES;
  totalCapturedEntries: number;
  droppedEntries: number;
  byteLength: number;
  lines: string[];
}

export interface LogRingPushOptions {
  ts?: string | undefined;
  level?: LogRingLevel | undefined;
  /** Caller guarantees `line` is already a single-line JSON object string. */
  trustedJson?: boolean | undefined;
}

interface RingEntry {
  text: string;
  bytes: number;
}

function isValidSingleLineJsonObject(text: string): boolean {
  if (!text || /[\r\n]/.test(text)) return false;
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function alignUtf8Cut(buf: Buffer, maxOffset: number): number {
  let cut = Math.max(0, Math.min(maxOffset, buf.length));
  if (cut < buf.length) {
    while (cut > 0 && (buf[cut]! & 0xc0) === 0x80) cut -= 1;
  }
  return cut;
}

function wrapFlatJsonLine(
  line: string,
  ts: string,
  level: LogRingLevel,
  rawBytes: number,
  wasOverlong: boolean,
): RingEntry {
  const buf = Buffer.from(line, 'utf8');
  let budget = Math.min(buf.length, INITIAL_PREVIEW_CUT_BYTES);

  while (true) {
    const cut = alignUtf8Cut(buf, budget);
    const truncated = wasOverlong || cut < buf.length;
    // Buffer.subarray(...).toString('utf8') allocates an independent flat string.
    const prefix = buf.subarray(0, cut).toString('utf8');
    const preview = truncated ? `${prefix}${TRUNCATION_SUFFIX}` : prefix;
    const wrapped = JSON.stringify({
      ts,
      level,
      truncated,
      originalBytes: rawBytes,
      preview,
    });
    const wrappedBytes = Buffer.byteLength(wrapped, 'utf8');
    if (wrappedBytes <= SERVICE_LOG_LINE_MAX_BYTES || cut === 0) {
      return { text: wrapped, bytes: wrappedBytes };
    }
    budget = Math.floor(cut * 0.6);
  }
}

export function normalizeLogRingLine(line: string, options: LogRingPushOptions = {}): RingEntry {
  const ts = options.ts ?? new Date().toISOString();
  const level = options.level ?? 'info';
  const rawBytes = Buffer.byteLength(line, 'utf8');

  if (rawBytes <= SERVICE_LOG_LINE_MAX_BYTES) {
    if (options.trustedJson && !/[\r\n]/.test(line)) {
      return { text: line, bytes: rawBytes };
    }
    const trimmed = line.trim();
    if (isValidSingleLineJsonObject(trimmed)) {
      const trimmedBytes =
        trimmed.length === line.length ? rawBytes : Buffer.byteLength(trimmed, 'utf8');
      return { text: trimmed, bytes: trimmedBytes };
    }
    return wrapFlatJsonLine(line, ts, level, rawBytes, false);
  }

  return wrapFlatJsonLine(line, ts, level, rawBytes, true);
}

/** Dual-capped (`500` lines AND `<= 512 KiB` UTF-8) in-memory log ring buffer. */
export class BoundedLogRing {
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private entries: RingEntry[] = [];
  private head = 0;
  private totalBytes = 0;
  private totalCaptured = 0;
  private dropped = 0;

  constructor(maxEntries = SERVICE_LOG_RING_MAX_ENTRIES, maxBytes = SERVICE_LOG_RING_MAX_BYTES) {
    this.maxEntries = Math.max(1, maxEntries);
    this.maxBytes = Math.max(SERVICE_LOG_LINE_MAX_BYTES, maxBytes);
  }

  push(line: string, options?: LogRingPushOptions): string {
    const entry = normalizeLogRingLine(line, options);
    this.entries.push(entry);
    this.totalBytes += entry.bytes;
    this.totalCaptured += 1;

    while (this.entries.length - this.head > this.maxEntries || this.totalBytes > this.maxBytes) {
      const oldest = this.entries[this.head]!;
      this.head += 1;
      this.totalBytes -= oldest.bytes;
      this.dropped += 1;
    }

    if (this.head > 256 && this.head * 2 >= this.entries.length) {
      this.entries = this.entries.slice(this.head);
      this.head = 0;
    }

    return entry.text;
  }

  snapshot(): BoundedLogRingSnapshot {
    return {
      maxBytes: SERVICE_LOG_RING_MAX_BYTES,
      totalCapturedEntries: this.totalCaptured,
      droppedEntries: this.dropped,
      byteLength: this.totalBytes,
      lines: this.entries.slice(this.head).map((entry) => entry.text),
    };
  }

  clear(): void {
    this.entries = [];
    this.head = 0;
    this.totalBytes = 0;
    this.totalCaptured = 0;
    this.dropped = 0;
  }
}
