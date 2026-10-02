import type { SessionManager } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from 'typebox';
import { Compile } from 'typebox/compile';
import type { ServiceBlock } from '@atd/agent-contracts';

/**
 * Service session entries (`app-compaction`) that complete what Pi persists about a compaction.
 * Pi's compaction entry keeps the summary and the tokens before, but not what triggered it or the
 * estimate after; a failed compaction leaves no entry at all. Custom entries never reach the
 * model, and both live and cold projections read them, so reloads show what the live view did.
 */
export const APP_COMPACTION = 'app-compaction';

const ReasonSchema = Type.Union([
  Type.Literal('manual'),
  Type.Literal('threshold'),
  Type.Literal('overflow'),
]);
export type CompactionReason = Static<typeof ReasonSchema>;

const CompactionRecordSchema = Type.Union([
  Type.Object(
    {
      status: Type.Literal('completed'),
      /** The Pi compaction entry this record completes. */
      compactionId: Type.String(),
      reason: ReasonSchema,
      tokensAfter: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
      at: Type.Number(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      status: Type.Literal('failed'),
      reason: ReasonSchema,
      error: Type.String(),
      at: Type.Number(),
    },
    { additionalProperties: false },
  ),
]);
type CompactionRecord = Static<typeof CompactionRecordSchema>;
/** Compiled once: every reprojection reads each custom entry on the branch through it. */
const CompactionRecordValidator = Compile(CompactionRecordSchema);
export type FailedCompaction = Extract<CompactionRecord, { status: 'failed' }>;

/** Records a finished compaction next to Pi's entry `compactionId`. */
export function recordCompleted(
  manager: SessionManager,
  compactionId: string,
  reason: CompactionReason,
  tokensAfter: number | undefined,
): void {
  const record: CompactionRecord = {
    status: 'completed',
    compactionId,
    reason,
    tokensAfter:
      tokensAfter !== undefined && Number.isFinite(tokensAfter)
        ? Math.max(0, Math.round(tokensAfter))
        : null,
    at: Date.now(),
  };
  manager.appendCustomEntry(APP_COMPACTION, record);
}

/** Records a failed compaction; Pi keeps nothing of it. */
export function recordFailed(
  manager: SessionManager,
  reason: CompactionReason,
  error: string,
): void {
  const record: CompactionRecord = { status: 'failed', reason, error, at: Date.now() };
  manager.appendCustomEntry(APP_COMPACTION, record);
}

/** A custom entry's data as a compaction record, or null for other entries and shapes. */
export function readCompactionRecord(customType: string, data: unknown): CompactionRecord | null {
  return customType === APP_COMPACTION && CompactionRecordValidator.Check(data) ? data : null;
}

/** What `completed` records add to Pi's compaction entries, by compaction entry id. */
export type CompletedLookup = Map<string, { reason: CompactionReason; tokensAfter: number | null }>;

export function collectCompleted(
  items: Iterable<{ type: string; customType?: string; data?: unknown }>,
): CompletedLookup {
  const completed: CompletedLookup = new Map();
  for (const item of items) {
    if (item.type !== 'custom' || item.customType === undefined) continue;
    const record = readCompactionRecord(item.customType, item.data);
    if (record?.status === 'completed')
      completed.set(record.compactionId, {
        reason: record.reason,
        tokensAfter: record.tokensAfter,
      });
  }
  return completed;
}

type BlockBase = Pick<ServiceBlock, 'runId' | 'timestamp' | 'endedAt'>;

/**
 * A completed compaction. Sessions compacted before the service recorded the trigger read as
 * `threshold`, Pi's only automatic trigger then. `tokensBefore` is provider-reported usage while
 * `tokensAfter` is Pi's character estimate, so an estimate that is not lower says nothing about
 * the compaction and reads as unknown rather than as context that grew.
 */
export function completedBlock(
  base: BlockBase & { id: string },
  entry: { summary: string; tokensBefore: number | null },
  completed: { reason: CompactionReason; tokensAfter: number | null } | undefined,
): ServiceBlock {
  const before = entry.tokensBefore === null ? null : Math.max(0, Math.round(entry.tokensBefore));
  const after = completed?.tokensAfter ?? null;
  return {
    kind: 'compaction',
    ...base,
    status: 'completed',
    reason: completed?.reason ?? 'threshold',
    summary: entry.summary,
    tokensBefore: before,
    tokensAfter: before !== null && after !== null && after < before ? after : null,
    error: '',
  };
}

export function failedBlock(
  base: BlockBase & { id: string },
  record: FailedCompaction,
): ServiceBlock {
  return {
    kind: 'compaction',
    ...base,
    status: 'failed',
    reason: record.reason,
    summary: '',
    tokensBefore: null,
    tokensAfter: null,
    error: record.error,
  };
}

/** The live compaction a session runs now (compaction/observer.ts). */
export interface RunningCompaction {
  reason: CompactionReason;
  startedAt: number;
}

export function runningBlock(runId: string, running: RunningCompaction): ServiceBlock {
  return {
    kind: 'compaction',
    id: `cmp:running:${running.startedAt}`,
    runId,
    timestamp: running.startedAt,
    endedAt: running.startedAt,
    status: 'running',
    reason: running.reason,
    summary: '',
    tokensBefore: null,
    tokensAfter: null,
    error: '',
  };
}
