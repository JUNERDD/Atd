import {
  DIAG_BATCH_MAX_ENTRIES,
  DIAG_CAT_MAX,
  DIAG_CDP_SESSION_MAX,
  DIAG_CODE_MAX,
  DIAG_DROPPED_MAX,
  DIAG_MSG_MAX,
  DIAG_ORIGIN_MAX,
  DIAG_SEQ_MAX,
  DIAG_TS_MAX,
  type DiagEntry,
  type DiagLevel,
  type DiagSurface,
} from '../channel/diagnostics.ts';
import type { ExtensionFrameBody } from '../channel/protocol.ts';
import { sanitizeOrigin, sanitizeSingleLine, sanitizeToken, utf8ByteLength } from './sanitize.ts';

/** Ring limits: `<= 128` entries and `<= 64 KiB` UTF-8 across the ring's entries. */
export const DIAG_RING_MAX_ENTRIES = 128;
export const DIAG_RING_MAX_BYTES = 64 * 1024;
/** K2 `diag.batch` wire budget (`<= 28 KiB` UTF-8, leaving headroom under Swift's 32 KiB cap). */
export const DIAG_BATCH_MAX_BYTES = 28 * 1024;
const RING_ENVELOPE_RESERVE = 64;
const ID_MAX = 256;
const TARGET_ID_MAX = 128;

export interface DiagRecordInput {
  surface: DiagSurface;
  level: DiagLevel;
  cat: string;
  msg: string;
  code?: string;
  runId?: string;
  tabId?: number;
  targetId?: string;
  cdpSession?: string;
  /** Either an already-sanitized origin/scheme or a raw URL (always sanitized before storing). */
  origin?: string;
  /** Raw URL to convert to an origin or scheme-only string when `origin` is omitted. */
  url?: string;
  extTs?: string;
}

interface StoredEntry {
  entry: DiagEntry;
  bytes: number;
}

export interface DiagRingState {
  nextSeq: number;
  dropped: number;
  entries: DiagEntry[];
}

export interface DiagBatchSlice {
  frame: ExtensionFrameBody<'diag.batch'>;
  count: number;
}

/**
 * Bounded flight-recorder ring (`<= 128` entries and `<= 64 KiB` UTF-8). Holds pending
 * unforwarded entries, tracks drops on eviction, supports startup-race-safe restoration and
 * dev-reload merging, and slices `<= 32`-entry / `<= 28 KiB` UTF-8 `diag.batch` frames.
 */
export class DiagRing {
  private items: StoredEntry[] = [];
  private totalBytes = 0;
  private nextSeq = 1;
  private dropped = 0;

  get size(): number {
    return this.items.length;
  }

  get byteLength(): number {
    return this.totalBytes;
  }

  get droppedCount(): number {
    return this.dropped;
  }

  hasError(): boolean {
    return this.items.some((item) => item.entry.level === 'error');
  }

  record(input: DiagRecordInput): DiagEntry {
    const seq = this.takeSeq();
    const entry = normalizeEntry(seq, input);
    this.appendEntry(entry);
    return entry;
  }

  /**
   * Merges restored entries (older dev-reload handoff + session entries) ahead of any entries
   * recorded early during boot before `restore()` resolved, keeping `seq` monotonic and bounded.
   */
  mergeRestored(
    older: readonly DiagEntry[],
    session: { nextSeq: number; dropped: number; entries: readonly DiagEntry[] } | undefined,
  ): void {
    const early = this.items.map((item) => item.entry);
    const mergedBase = deduplicateEntries([...older, ...(session?.entries ?? [])]);
    let maxSeq = session?.nextSeq ? session.nextSeq - 1 : 0;
    for (const entry of mergedBase) {
      if (entry.seq > maxSeq) maxSeq = entry.seq;
    }
    this.items = [];
    this.totalBytes = 0;
    this.dropped = clampDropped((session?.dropped ?? 0) + this.dropped);
    this.nextSeq = nextSequenceAfter(maxSeq);

    for (const entry of mergedBase) this.appendEntry(entry);
    for (const entry of early) {
      const resequenced: DiagEntry = { ...entry, seq: this.takeSeq() };
      this.appendEntry(resequenced);
    }
  }

  /**
   * Produces a bounded `DiagEntry[]` array combining existing `atd.devDiag` entries, any
   * unrestored `atd.diag` entries, and current in-memory entries for a dev-reload handoff.
   */
  collectForDevReload(
    existingDevDiag: readonly DiagEntry[],
    unrestoredSession: readonly DiagEntry[],
  ): DiagEntry[] {
    const combined = deduplicateEntries([
      ...existingDevDiag,
      ...unrestoredSession,
      ...this.items.map((item) => item.entry),
    ]);
    return boundEntryArray(combined);
  }

  /** Peaks the next K2 `diag.batch` frame (`<= 32` entries and `<= 28 KiB` UTF-8) without mutating. */
  peekBatch(): DiagBatchSlice | undefined {
    if (this.items.length === 0) return undefined;
    const dropped = this.dropped > 0 ? clampDropped(this.dropped) : undefined;
    const envelope: ExtensionFrameBody<'diag.batch'> = {
      t: 'diag.batch',
      ...(dropped === undefined ? {} : { dropped }),
      entries: [],
    };
    let wireBytes = utf8ByteLength(JSON.stringify({ v: 1, ...envelope }));
    const entries: DiagEntry[] = [];
    for (const item of this.items) {
      if (entries.length >= DIAG_BATCH_MAX_ENTRIES) break;
      const addedBytes = item.bytes + (entries.length > 0 ? 1 : 0);
      if (entries.length > 0 && wireBytes + addedBytes > DIAG_BATCH_MAX_BYTES) break;
      entries.push(item.entry);
      wireBytes += addedBytes;
    }
    if (entries.length === 0) return undefined;
    return {
      frame: {
        t: 'diag.batch',
        ...(dropped === undefined ? {} : { dropped }),
        entries,
      },
      count: entries.length,
    };
  }

  /** Marks the front `count` entries as forwarded and clears `dropped`. */
  ackBatch(count: number): void {
    const remove = Math.min(Math.max(0, count), this.items.length);
    for (let index = 0; index < remove; index += 1) {
      const removed = this.items.shift();
      if (removed !== undefined) this.totalBytes -= removed.bytes;
    }
    if (this.items.length === 0) this.totalBytes = 0;
    this.dropped = 0;
  }

  snapshot(): DiagRingState {
    return {
      nextSeq: this.nextSeq,
      dropped: clampDropped(this.dropped),
      entries: this.items.map((item) => item.entry),
    };
  }

  private appendEntry(entry: DiagEntry): void {
    const bytes = utf8ByteLength(JSON.stringify(entry));
    while (
      this.items.length >= DIAG_RING_MAX_ENTRIES ||
      (this.items.length > 0 &&
        this.totalBytes + bytes + this.items.length + RING_ENVELOPE_RESERVE > DIAG_RING_MAX_BYTES)
    ) {
      const evicted = this.items.shift();
      if (evicted === undefined) break;
      this.totalBytes -= evicted.bytes;
      this.dropped = clampDropped(this.dropped + 1);
    }
    this.items.push({ entry, bytes });
    this.totalBytes += bytes;
  }

  private takeSeq(): number {
    const seq = this.nextSeq;
    this.nextSeq = nextSequenceAfter(seq);
    return seq;
  }
}

function nextSequenceAfter(current: number): number {
  return current >= DIAG_SEQ_MAX || current < 0 ? 1 : current + 1;
}

function clampDropped(value: number): number {
  return Math.min(Math.max(0, Math.trunc(value)), DIAG_DROPPED_MAX);
}

function normalizeEntry(seq: number, input: DiagRecordInput): DiagEntry {
  const extTs =
    sanitizeToken(input.extTs ?? new Date().toISOString(), DIAG_TS_MAX) ||
    '1970-01-01T00:00:00.000Z';
  const cat = sanitizeToken(input.cat, DIAG_CAT_MAX) || 'runtime';
  const code = input.code === undefined ? undefined : sanitizeToken(input.code, DIAG_CODE_MAX);
  const msg = sanitizeSingleLine(input.msg, DIAG_MSG_MAX) || code || cat;
  const runId = input.runId === undefined ? undefined : sanitizeToken(input.runId, ID_MAX);
  const tabId =
    input.tabId !== undefined && Number.isInteger(input.tabId) && input.tabId >= 0
      ? input.tabId
      : undefined;
  const targetId =
    input.targetId === undefined ? undefined : sanitizeToken(input.targetId, TARGET_ID_MAX);
  const cdpSession =
    input.cdpSession === undefined
      ? undefined
      : sanitizeToken(input.cdpSession, DIAG_CDP_SESSION_MAX);
  const origin = resolveOrigin(input.origin, input.url);
  return {
    seq,
    extTs,
    surface: input.surface,
    level: input.level,
    cat,
    msg,
    ...(code ? { code } : {}),
    ...(runId ? { runId } : {}),
    ...(tabId === undefined ? {} : { tabId }),
    ...(targetId ? { targetId } : {}),
    ...(cdpSession ? { cdpSession } : {}),
    ...(origin ? { origin } : {}),
  };
}

function resolveOrigin(origin: string | undefined, url: string | undefined): string | undefined {
  if (url !== undefined) return sanitizeOrigin(url);
  if (origin === undefined) return undefined;
  const parsed = sanitizeOrigin(origin);
  if (parsed !== undefined) return parsed;
  // Already a scheme-only marker such as `chrome:` or `file:`.
  const schemeOnly = sanitizeToken(origin, DIAG_ORIGIN_MAX);
  return /^[A-Za-z][A-Za-z0-9+.-]*:$/.test(schemeOnly) ? schemeOnly.toLowerCase() : undefined;
}

function entryKey(entry: DiagEntry): string {
  return `${entry.extTs}\0${entry.seq}\0${entry.surface}\0${entry.cat}\0${entry.code ?? ''}\0${entry.msg}`;
}

function deduplicateEntries(entries: readonly DiagEntry[]): DiagEntry[] {
  const seen = new Set<string>();
  const result: DiagEntry[] = [];
  for (const entry of entries) {
    const key = entryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

function boundEntryArray(entries: readonly DiagEntry[]): DiagEntry[] {
  const stored: StoredEntry[] = [];
  let totalBytes = 0;
  for (const entry of entries) {
    const bytes = utf8ByteLength(JSON.stringify(entry));
    while (
      stored.length >= DIAG_RING_MAX_ENTRIES ||
      (stored.length > 0 &&
        totalBytes + bytes + stored.length + RING_ENVELOPE_RESERVE > DIAG_RING_MAX_BYTES)
    ) {
      const evicted = stored.shift();
      if (evicted === undefined) break;
      totalBytes -= evicted.bytes;
    }
    stored.push({ entry, bytes });
    totalBytes += bytes;
  }
  return stored.map((item) => item.entry);
}
