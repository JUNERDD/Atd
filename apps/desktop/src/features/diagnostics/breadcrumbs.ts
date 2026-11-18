import type { CallParams } from '../../native-bridge/client';

export const BREADCRUMB_MAX_ENTRIES = 128;
export const BREADCRUMB_MAX_TOTAL_BYTES = 131_072;
export const BREADCRUMB_MAX_ENTRY_BYTES = 1024;
export const BREADCRUMB_MAX_MESSAGE_UNITS = 320;
const ENVELOPE_RESERVE_BYTES = 128;

export type RendererBreadcrumbsPayload =
  CallParams<'diagnostics.previewBundle'>['rendererBreadcrumbs'];
export type RendererBreadcrumbItem = RendererBreadcrumbsPayload['entries'][number];
export type BreadcrumbCategory = RendererBreadcrumbItem['category'];
export type BreadcrumbWindowRole = RendererBreadcrumbItem['windowRole'];

// Module singletons prevent allocating a multi-megabyte buffer for oversized WS/error strings.
const sharedEncoder = new TextEncoder();
const sharedDecoder = new TextDecoder();
const sharedScratchUint8Array = new Uint8Array(1024);

/** Detaches `<= 320` UTF-16 code units into a fresh string without lone surrogates. */
export function detachText320(input: string, maxUnits = BREADCRUMB_MAX_MESSAGE_UNITS): string {
  if (!input) return '';
  const limit = Math.min(Math.max(0, maxUnits), BREADCRUMB_MAX_MESSAGE_UNITS);
  if (limit === 0) return '';
  const { written } = sharedEncoder.encodeInto(input.slice(0, limit), sharedScratchUint8Array);
  return sharedDecoder.decode(sharedScratchUint8Array.subarray(0, written));
}

function detachOptional64(input: string | null | undefined): string | null {
  if (!input) return null;
  return detachText320(input, 64).trim() || null;
}

const utf8ByteLength = (text: string) => sharedEncoder.encode(text).byteLength;

export function resolveWindowRole(): BreadcrumbWindowRole {
  const role =
    typeof document !== 'undefined' ? document.documentElement?.dataset?.window : undefined;
  if (role === 'panel' || role === 'settings' || role === 'onboarding' || role === 'view')
    return role;
  if (typeof window !== 'undefined') {
    const hash = window.location.hash;
    if (hash === '#settings' || hash.startsWith('#settings?')) return 'settings';
    if (hash === '#onboarding') return 'onboarding';
    if (hash.startsWith('#view?')) return 'view';
  }
  return 'panel';
}

export interface BreadcrumbInput {
  category: BreadcrumbCategory;
  code?: string | null;
  name?: string | null;
  message: string;
  windowRole?: BreadcrumbWindowRole;
  ts?: string;
}

/** Bounded in-memory breadcrumb ring (`<= 128` entries and `<= 128 KiB` serialized JSON). */
export class DiagnosticsBreadcrumbs {
  private entries: Array<{ item: RendererBreadcrumbItem; bytes: number }> = [];
  private totalEntryBytes = 0;
  private nextSeq = 1;
  private droppedCount = 0;

  record(input: BreadcrumbInput): void {
    const seq = this.nextSeq++;
    const ts = detachText320(input.ts ?? new Date().toISOString(), 64);
    const windowRole = input.windowRole ?? resolveWindowRole();
    const code = detachOptional64(input.code);
    const name = detachOptional64(input.name);
    const entry = this.fitEntry(seq, ts, input.category, windowRole, code, name, input.message);
    while (
      this.entries.length >= BREADCRUMB_MAX_ENTRIES ||
      this.totalEntryBytes + entry.bytes + this.entries.length + ENVELOPE_RESERVE_BYTES >
        BREADCRUMB_MAX_TOTAL_BYTES
    ) {
      const evicted = this.entries.shift();
      if (!evicted) break;
      this.totalEntryBytes -= evicted.bytes;
      this.droppedCount += 1;
    }
    this.entries.push(entry);
    this.totalEntryBytes += entry.bytes;
  }

  snapshot(): RendererBreadcrumbsPayload {
    return {
      capturedAt: new Date().toISOString(),
      droppedCount: this.droppedCount,
      entries: this.entries.map((entry) => entry.item),
    };
  }

  readSerializedJson(maxChars = BREADCRUMB_MAX_TOTAL_BYTES): string {
    const capturedAt = new Date().toISOString();
    for (let start = 0; start <= this.entries.length; start += 1) {
      const json = JSON.stringify({
        capturedAt,
        droppedCount: this.droppedCount + start,
        entries: this.entries.slice(start).map((entry) => entry.item),
      });
      if (json.length <= maxChars && utf8ByteLength(json) <= maxChars) return json;
    }
    return JSON.stringify({
      capturedAt,
      droppedCount: this.droppedCount + this.entries.length,
      entries: [],
    });
  }

  clear(): void {
    this.entries = [];
    this.totalEntryBytes = 0;
    this.nextSeq = 1;
    this.droppedCount = 0;
  }

  size = () => this.entries.length;
  byteLength = () => this.totalEntryBytes;

  private fitEntry(
    seq: number,
    ts: string,
    category: BreadcrumbCategory,
    windowRole: BreadcrumbWindowRole,
    code: string | null,
    name: string | null,
    rawMessage: string,
  ) {
    for (let limit = BREADCRUMB_MAX_MESSAGE_UNITS; ; limit = Math.max(0, limit - 32)) {
      const item: RendererBreadcrumbItem = {
        seq,
        ts,
        category,
        windowRole,
        code,
        name,
        message: detachText320(rawMessage, limit),
      };
      const bytes = utf8ByteLength(JSON.stringify(item));
      if (bytes <= BREADCRUMB_MAX_ENTRY_BYTES || limit === 0) return { item, bytes };
    }
  }
}

export const diagnosticsBreadcrumbs = new DiagnosticsBreadcrumbs();

export function recordNormalizedError(
  category: Exclude<BreadcrumbCategory, 'stream_state'>,
  error: unknown,
  fallbackCode: string | null = null,
): void {
  const errObj =
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : null;
  const code =
    typeof errObj?.code === 'string'
      ? errObj.code
      : typeof errObj?.status === 'number'
        ? String(errObj.status)
        : fallbackCode;
  const name = error instanceof Error ? error.name : null;
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message || error.name
        : 'Unexpected error';
  diagnosticsBreadcrumbs.record({ category, code, name, message });
}
