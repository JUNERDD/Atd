import { Type } from 'typebox';
import { Value } from 'typebox/value';
import {
  DIAG_DROPPED_MAX,
  DIAG_SEQ_MAX,
  DiagEntrySchema,
  type DiagEntry,
} from '../channel/diagnostics.ts';
import type { SendFrame } from '../background/native.ts';
import type { DiagEventMessage } from '../messages/diag-event.ts';
import {
  DIAG_RING_MAX_ENTRIES,
  DiagRing,
  type DiagRecordInput,
  type DiagRingState,
} from './ring.ts';
import { summarizeError } from './sanitize.ts';

/** Session-storage key for pending diagnostic entries across MV3 idle stops. */
export const DIAG_SESSION_KEY = 'atd.diag';
/** Local-storage key for dev-reload handoff (Chrome clears session storage on runtime.reload). */
export const DIAG_DEV_HANDOFF_KEY = 'atd.devDiag';
/** Normal coalescing window for `info`/`warn` diagnostic flushes. */
export const FLUSH_NORMAL_MS = 1_000;
/** Expedited coalescing window when an `error` diagnostic arrives. */
export const FLUSH_ERROR_MS = 250;
/** Content-script `diag.event` budget per tab within a sliding minute window. */
export const CONTENT_RATE_LIMIT = 8;
export const CONTENT_RATE_WINDOW_MS = 60_000;
const MAX_RATE_TRACKED_TABS = 256;

const StoredSessionDiagSchema = Type.Object({
  nextSeq: Type.Integer({ minimum: 1, maximum: DIAG_SEQ_MAX }),
  dropped: Type.Integer({ minimum: 0, maximum: DIAG_DROPPED_MAX }),
  entries: Type.Array(DiagEntrySchema, { maxItems: DIAG_RING_MAX_ENTRIES }),
});

/** Convenience callback type for background modules reporting structured diagnostics. */
export type BackgroundDiagInput = Omit<DiagRecordInput, 'surface'>;
export type BackgroundDiagReporter = (input: BackgroundDiagInput) => void;

/**
 * Extension-wide flight recorder in the MV3 service worker:
 * - Bounded in-memory ring (`<= 128` entries / `<= 64 KiB` UTF-8) persisted via microtask-coalesced
 *   `chrome.storage.session` (`atd.diag`, never calling `setAccessLevel`).
 * - Startup-race-safe dev-reload handoff via `chrome.storage.local` (`atd.devDiag`).
 * - Coalesced K2 `diag.batch` forwarder (`1s` normal / `250ms` error) active ONLY while
 *   `paired === true` (`welcome.paired` or `pair.state === 'paired'`), with zero feedback loops.
 * - Per-tab sliding-window rate limiter (`<= 8`/min per `tabId`) for content-script `diag.event`.
 */
export class DiagRecorder {
  private readonly ring = new DiagRing();
  private readonly contentRates = new Map<number, number[]>();
  private paired = false;
  private restored = false;
  private reloading = false;
  private removingDevDiag: Promise<void> | undefined;
  private persistScheduled = false;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private flushUrgent = false;

  constructor(private readonly send: SendFrame) {}

  get size(): number {
    return this.ring.size;
  }

  get droppedCount(): number {
    return this.ring.droppedCount;
  }

  get isPaired(): boolean {
    return this.paired;
  }

  snapshot(): DiagRingState {
    return this.ring.snapshot();
  }

  /** Records one diagnostic entry from any extension surface. */
  record(input: DiagRecordInput): void {
    this.ring.record(input);
    this.schedulePersist();
    if (this.paired) this.scheduleFlush(input.level === 'error');
  }

  /** Records a background service-worker diagnostic entry. */
  recordBackground(input: BackgroundDiagInput): void {
    this.record({ surface: 'background', ...input });
  }

  /**
   * Records a `diag.event` from a content script after enforcing `<= 8`/min per `tabId`.
   * `tabId` and `origin` MUST come strictly from `port.sender.tab`, never from the message.
   */
  recordContentEvent(
    tabId: number,
    origin: string | undefined,
    event: DiagEventMessage,
    now = Date.now(),
  ): boolean {
    if (!this.allowContentEvent(tabId, now)) return false;
    this.record({
      surface: 'content',
      level: event.level,
      cat: event.cat,
      ...(event.code === undefined ? {} : { code: event.code }),
      msg: event.msg,
      tabId,
      ...(origin === undefined ? {} : { origin }),
    });
    return true;
  }

  /**
   * Records a dropped invalid content-script port message under the same per-tab rate limit
   * (`<= 8`/min per `tabId`) as `recordContentEvent`, preventing a compromised renderer from
   * evicting legitimate ring entries or draining the shell's token bucket.
   */
  recordContentInvalid(tabId: number, now = Date.now()): boolean {
    if (!this.allowContentEvent(tabId, now)) return false;
    this.recordBackground({
      level: 'warn',
      cat: 'port',
      code: 'invalid_content_message',
      tabId,
      msg: 'Dropped invalid content script port message',
    });
    return true;
  }

  /** Records a `diag.event` from an extension UI surface (`panel` or `options`). */
  recordSurfaceEvent(surface: 'panel' | 'options', event: DiagEventMessage): void {
    this.record({
      surface,
      level: event.level,
      cat: event.cat,
      ...(event.code === undefined ? {} : { code: event.code }),
      msg: event.msg,
    });
  }

  /** Drops per-tab rate-limit tracking when Chrome closes the tab. */
  forgetTab(tabId: number): void {
    this.contentRates.delete(tabId);
  }

  /**
   * Updates whether the current shell session is confirmed paired (`welcome.paired` or
   * `pair.state === 'paired'`). Never sends `diag.batch` while false.
   */
  setPaired(paired: boolean): void {
    this.paired = paired;
    if (!paired) {
      this.cancelFlush();
      return;
    }
    if (this.ring.size > 0) this.scheduleFlush(this.ring.hasError());
  }

  /**
   * Restores pending diagnostics at worker boot: merges `atd.devDiag` (if present) + `atd.diag`
   * ahead of any early boot entries, then removes `atd.devDiag`.
   */
  async restore(): Promise<void> {
    const [localStored, sessionStored] = await Promise.all([
      chrome.storage.local.get(DIAG_DEV_HANDOFF_KEY).catch(() => ({})),
      chrome.storage.session.get(DIAG_SESSION_KEY).catch(() => ({})),
    ]);
    const localRaw: unknown = Reflect.get(localStored, DIAG_DEV_HANDOFF_KEY);
    const sessionRaw: unknown = Reflect.get(sessionStored, DIAG_SESSION_KEY);
    const devEntries = validEntries(localRaw);
    const sessionState = Value.Check(StoredSessionDiagSchema, sessionRaw) ? sessionRaw : undefined;
    this.ring.mergeRestored(devEntries, sessionState);
    this.restored = true;
    if (localRaw !== undefined && !this.reloading) {
      const removal = chrome.storage.local
        .remove(DIAG_DEV_HANDOFF_KEY)
        .catch(() => undefined)
        .finally(() => {
          if (this.removingDevDiag === removal) this.removingDevDiag = undefined;
        });
      this.removingDevDiag = removal;
      await removal;
    }
    this.schedulePersist();
    if (this.paired && this.ring.size > 0) this.scheduleFlush(this.ring.hasError());
  }

  /**
   * Startup-race-safe dev-reload handoff: merges any existing `atd.devDiag`, any unrestored
   * `atd.diag` (if `watchDevBuilds` triggered before `boot()` finished), and in-memory pending
   * entries into `chrome.storage.local` (`atd.devDiag`). Never overwrites existing `atd.devDiag`
   * with an empty unbooted ring.
   */
  async prepareDevReload(): Promise<void> {
    this.reloading = true;
    this.cancelFlush();
    await this.removingDevDiag;
    const [localStored, sessionStored] = await Promise.all([
      chrome.storage.local.get(DIAG_DEV_HANDOFF_KEY).catch(() => ({})),
      this.restored
        ? Promise.resolve({})
        : chrome.storage.session.get(DIAG_SESSION_KEY).catch(() => ({})),
    ]);
    const existingDevDiag = validEntries(Reflect.get(localStored, DIAG_DEV_HANDOFF_KEY));
    const sessionRaw: unknown = Reflect.get(sessionStored, DIAG_SESSION_KEY);
    const unrestoredSession = Value.Check(StoredSessionDiagSchema, sessionRaw)
      ? sessionRaw.entries
      : [];
    const merged = this.ring.collectForDevReload(existingDevDiag, unrestoredSession);
    if (merged.length > 0) {
      await chrome.storage.local.set({ [DIAG_DEV_HANDOFF_KEY]: merged }).catch(() => undefined);
    }
  }

  /**
   * Flushes pending batches (`<= 32` entries and `<= 28 KiB` UTF-8 each) while paired.
   * Send failures leave entries in place without recording or rescheduling (zero feedback loop).
   */
  flushNow(): number {
    this.cancelFlush();
    if (!this.paired) return 0;
    let sentBatches = 0;
    while (this.paired) {
      const slice = this.ring.peekBatch();
      if (slice === undefined) break;
      if (!this.send(slice.frame)) break;
      this.ring.ackBatch(slice.count);
      sentBatches += 1;
    }
    if (sentBatches > 0) this.schedulePersist();
    return sentBatches;
  }

  private scheduleFlush(urgent: boolean): void {
    if (!this.paired || this.ring.size === 0) return;
    if (this.flushTimer !== undefined) {
      if (!urgent || this.flushUrgent) return;
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.flushUrgent = urgent;
    this.flushTimer = setTimeout(
      () => {
        this.flushTimer = undefined;
        this.flushUrgent = false;
        this.flushNow();
      },
      urgent ? FLUSH_ERROR_MS : FLUSH_NORMAL_MS,
    );
  }

  private cancelFlush(): void {
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.flushUrgent = false;
  }

  private schedulePersist(): void {
    if (this.persistScheduled) return;
    this.persistScheduled = true;
    queueMicrotask(() => {
      this.persistScheduled = false;
      chrome.storage.session
        .set({ [DIAG_SESSION_KEY]: this.ring.snapshot() })
        .catch(() => undefined);
    });
  }

  private allowContentEvent(tabId: number, now: number): boolean {
    const cutoff = now - CONTENT_RATE_WINDOW_MS;
    const recent = (this.contentRates.get(tabId) ?? []).filter((ts) => ts > cutoff);
    if (recent.length >= CONTENT_RATE_LIMIT) {
      this.contentRates.set(tabId, recent);
      return false;
    }
    recent.push(now);
    this.contentRates.set(tabId, recent);
    if (this.contentRates.size > MAX_RATE_TRACKED_TABS) this.pruneRateMap(cutoff);
    return true;
  }

  private pruneRateMap(cutoff: number): void {
    for (const [tabId, timestamps] of this.contentRates) {
      const active = timestamps.filter((ts) => ts > cutoff);
      if (active.length === 0) this.contentRates.delete(tabId);
      else this.contentRates.set(tabId, active);
    }
  }
}

/** Captures uncaught errors and unhandled rejections in the MV3 service worker's first turn. */
export function installBackgroundErrorCapture(recorder: DiagRecorder): void {
  self.addEventListener('error', (event: ErrorEvent) => {
    recorder.recordBackground({
      level: 'error',
      cat: 'runtime',
      code: 'uncaught_error',
      msg: summarizeError(event.error ?? event.message, 'Uncaught worker error'),
    });
  });
  self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    recorder.recordBackground({
      level: 'error',
      cat: 'runtime',
      code: 'unhandled_rejection',
      msg: summarizeError(event.reason, 'Unhandled worker rejection'),
    });
  });
}

function validEntries(value: unknown): DiagEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: DiagEntry[] = [];
  for (const item of value) {
    if (Value.Check(DiagEntrySchema, item)) entries.push(item);
  }
  return entries;
}
