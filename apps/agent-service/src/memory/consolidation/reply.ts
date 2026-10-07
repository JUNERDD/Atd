import type { LearnerOp } from '../engine-types.js';
import { replyPayload, toOp, type LearnerReply } from '../learner/ops.js';

/** One consolidation folds a handful of duplicates at most; anything beyond is a runaway reply. */
export const MAX_CONSOLIDATION_OPS = 12;
/** The summary goes on a run record and a notification. */
const SUMMARY_CHARS = 300;

/** What a consolidation reply asks for, and the reasons for the operations dropped. */
export interface ConsolidationReply {
  /** One sentence in the memories' language; empty when the model gave none. */
  summary: string;
  ops: LearnerOp[];
  dropped: string[];
}

/**
 * The reply's summary and operations, or null when it holds no final operations payload: one only
 * drafted in the reasoning, with text after it, may have been revised, and unlike a learner's
 * creates no consolidation operation is safe to keep from a draft. Each operation is validated
 * like a learner's (learner/ops.ts); only `update` and `remove` of a unit in `targets` (view.ts)
 * are kept, and every other one is dropped with its reason.
 */
export function parseConsolidationReply(
  reply: LearnerReply,
  targets: ReadonlySet<string>,
): ConsolidationReply | null {
  const found = replyPayload(reply);
  if (!found?.final) return null;
  const { summary, operations } = found.payload;
  const ops: LearnerOp[] = [];
  const dropped: string[] = [];
  operations.forEach((item, index) => {
    const label = `operation ${index + 1}`;
    if (index >= MAX_CONSOLIDATION_OPS) {
      dropped.push(`${label}: over the limit of ${MAX_CONSOLIDATION_OPS}`);
      return;
    }
    const op = toOp(item);
    if (typeof op === 'string') dropped.push(`${label}: ${op}`);
    else if (op.op !== 'update' && op.op !== 'remove')
      dropped.push(`${label}: ${op.op} is not a consolidation operation`);
    else if (!targets.has(op.name))
      dropped.push(`${label}: "${op.name}" is not a memory this consolidation may change`);
    else ops.push(op);
  });
  return { summary: oneLine(summary), ops, dropped };
}

function oneLine(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, SUMMARY_CHARS);
}
