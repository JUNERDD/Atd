import type { RunSnapshot } from '@ai/agent-contracts';

/**
 * Character budget for the text one run brings into context. Acceptance
 * rejects a run whose own input exceeds it; reference material resolved at
 * freeze (references/material.ts) fills only what the input leaves.
 * Attachments are outside this budget: their size is capped at upload.
 */
export const CONTEXT_BUDGET = 120000;

/** Characters of a run's own input that count against the budget. */
export function runInputSize(snapshot: RunSnapshot): number {
  return (
    snapshot.input.text.length +
    snapshot.instructions.length +
    JSON.stringify(snapshot.input.arguments).length
  );
}
