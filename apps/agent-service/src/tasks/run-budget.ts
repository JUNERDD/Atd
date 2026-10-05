import type { RunSnapshot } from '@atd/agent-contracts';
import { quoteMaterial } from '../references/quotes.js';

/**
 * Character budget for the text one run brings into context. Acceptance
 * rejects a run whose own input exceeds it. At freeze the run's skills come
 * next and fail the run when they overflow it (skills/run-skills.ts); the
 * memory sections (memory/run-memory.ts) shrink to what is left instead of
 * failing it, and reference material (references/material.ts) fills only what
 * the input, skills and memory leave. Attachments are outside this budget:
 * their size is capped at upload.
 */
export const CONTEXT_BUDGET = 120000;

/**
 * Characters of a run's own input that count against the budget, including the passages its
 * message quotes as the run material renders them (references/quotes.ts).
 */
export function runInputSize(snapshot: RunSnapshot): number {
  return (
    snapshot.input.text.length +
    snapshot.instructions.length +
    JSON.stringify(snapshot.input.arguments).length +
    quoteMaterial(snapshot.input).text.length
  );
}
