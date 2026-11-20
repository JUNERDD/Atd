/**
 * Bounded in-memory ring (`32` slots, `<= 32 KiB` UTF-8) recording run preparation
 * timing summaries, slow settles, errors, and silent selection degradations
 * without storing prompts, instructions, or personal filesystem paths.
 */

export const RUN_PREP_RING_CAPACITY = 32;
export const RUN_PREP_RING_MAX_BYTES = 32_768;

export type RunPrepOutcome = 'completed' | 'error' | 'stopped' | 'no_turn' | 'degraded';

export interface RunPrepDecisionEntry {
  seq: number;
  ts: string;
  runIdPrefix: string;
  phase: string;
  durationMs: number;
  outcome: RunPrepOutcome;
  reasonCode: string | null;
}

export interface RunPrepDecisionSnapshot {
  capacity: number;
  droppedCount: number;
  entries: RunPrepDecisionEntry[];
}

export interface RecordRunPrepInput {
  runId: string;
  phase: string;
  durationMs?: number | undefined;
  outcome: RunPrepOutcome;
  reasonCode?: string | null | undefined;
  ts?: string | undefined;
}

const MACHINE_CODE_RE = /^[a-z][a-z0-9_.-]{0,95}$/;

function sanitizeRunIdPrefix(runId: string): string {
  const cleaned = runId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8);
  return cleaned || 'unknown';
}

function sanitizePhase(phase: string): string {
  const cleaned = phase.trim().slice(0, 64);
  return cleaned || 'unknown';
}

export function sanitizeMachineCode(value: string | null | undefined): string | null {
  if (!value) return null;
  if (MACHINE_CODE_RE.test(value)) return value;
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .slice(0, 96);
  return MACHINE_CODE_RE.test(normalized) ? normalized : 'unknown';
}

interface StoredEntry {
  entry: RunPrepDecisionEntry;
  bytes: number;
}

/** Fixed-capacity (`<= 32` entries and `<= 32 KiB`) ring of run preparation decisions. */
export class RunPrepDecisionRing {
  private readonly capacity: number;
  private readonly maxBytes: number;
  private items: StoredEntry[] = [];
  private nextSeq = 1;
  private totalBytes = 0;
  private dropped = 0;

  constructor(capacity = RUN_PREP_RING_CAPACITY, maxBytes = RUN_PREP_RING_MAX_BYTES) {
    this.capacity = Math.max(1, Math.min(RUN_PREP_RING_CAPACITY, capacity));
    this.maxBytes = Math.max(512, Math.min(RUN_PREP_RING_MAX_BYTES, maxBytes));
  }

  record(input: RecordRunPrepInput): RunPrepDecisionEntry {
    const entry: RunPrepDecisionEntry = {
      seq: this.nextSeq,
      ts: input.ts ?? new Date().toISOString(),
      runIdPrefix: sanitizeRunIdPrefix(input.runId),
      phase: sanitizePhase(input.phase),
      durationMs: Math.max(0, Math.round(input.durationMs ?? 0)),
      outcome: input.outcome,
      reasonCode: sanitizeMachineCode(input.reasonCode),
    };
    this.nextSeq += 1;

    const bytes = Buffer.byteLength(JSON.stringify(entry), 'utf8');
    if (bytes <= this.maxBytes) {
      this.items.push({ entry, bytes });
      this.totalBytes += bytes;
      while (this.items.length > this.capacity || this.totalBytes > this.maxBytes) {
        const evicted = this.items.shift()!;
        this.totalBytes -= evicted.bytes;
        this.dropped += 1;
      }
    } else {
      this.dropped += 1;
    }

    return entry;
  }

  snapshot(): RunPrepDecisionSnapshot {
    return {
      capacity: this.capacity,
      droppedCount: this.dropped,
      entries: this.items.map((item) => ({ ...item.entry })),
    };
  }

  clear(): void {
    this.items = [];
    this.nextSeq = 1;
    this.totalBytes = 0;
    this.dropped = 0;
  }
}

let defaultRing = new RunPrepDecisionRing();

export function getRunPrepDecisionRing(): RunPrepDecisionRing {
  return defaultRing;
}

export function resetRunPrepDecisionRing(): RunPrepDecisionRing {
  defaultRing = new RunPrepDecisionRing();
  return defaultRing;
}

export function recordRunPrepDegradation(
  runId: string,
  phase: string,
  reasonCode: string,
  durationMs = 0,
): void {
  defaultRing.record({ runId, phase, durationMs, outcome: 'degraded', reasonCode });
}

export function recordRunPrepTiming(
  runId: string,
  phase: string,
  durationMs: number,
  outcome: Exclude<RunPrepOutcome, 'degraded'>,
): void {
  const rounded = Math.max(0, Math.round(durationMs));
  const slowSettle = phase === 'session_settled' && rounded > 1000;
  const shouldCapture =
    outcome !== 'completed' || phase === 'execute_to_first_turn' || slowSettle || rounded >= 500;
  if (!shouldCapture) return;
  const reasonCode = slowSettle
    ? 'session_slot_settle_slow'
    : outcome !== 'completed'
      ? outcome
      : rounded >= 500 && phase !== 'execute_to_first_turn'
        ? 'slow_phase'
        : null;
  defaultRing.record({ runId, phase, durationMs: rounded, outcome, reasonCode });
}
