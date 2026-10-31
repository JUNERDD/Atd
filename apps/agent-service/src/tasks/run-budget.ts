import type { RunSnapshot } from '@atd/agent-contracts';
import { isRestrictedComputerRun } from '../computer/tool-set.js';
import { quoteMaterial } from '../references/quotes.js';

/**
 * Character budget for the text one run brings into context. Acceptance
 * rejects a run whose own input exceeds it. At freeze the run's skills come
 * next and fail the run when they overflow it (skills/run-skills.ts); the
 * memory sections (memory/run-memory.ts) shrink to what is left instead of
 * failing it, and reference material (references/material.ts) fills only what
 * the input, skills and memory leave. Attached files have a budget of their
 * own, in estimated tokens scaled to the run's context window (`materialBudget`).
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

/**
 * How much of its attached files' loaded text a run's material carries, in estimated tokens
 * (file-loader/material.ts `estimateTokens`). The rest of a cut file stays in its resource.
 */
export interface MaterialBudget {
  /** Across the run's files that are not image input. */
  total: number;
  /** For any one of them; the split stays fair when several need more (`shareBudget`). */
  perFile: number;
  /** Whether the run has `read`, which continues a cut file from its resource. */
  read: boolean;
  /**
   * Whether the material recognizes the text of PDF pages without a text layer, within `perFile`
   * (file-loader/pdf-ocr.ts): the run has no `bash` to run the file-loader skill's OCR script.
   */
  recognize: boolean;
}

/**
 * The material's share of the context window. With `read` the material is a start the model
 * continues on demand, so it stays small and one file takes at most `PER_FILE_SHARE` of it.
 * Without `read` the material is all the model gets of the files, so it may take more of the
 * window and a single file all of it.
 */
const WINDOW_SHARE = { read: 0.15, noRead: 0.45 };
const PER_FILE_SHARE = 0.4;
/** Below these a cut file says too little to be useful; a window that small barely holds a run. */
const MIN_TOTAL = 2_000;
const MIN_PER_FILE = 1_000;
/**
 * Above these the material, which every later request of the task sends again, costs more than
 * it is worth: with `read` the model loads the rest when it needs it, and without it 200,000
 * tokens hold a book of about 400 pages.
 */
const MAX_TOTAL = { read: 60_000, noRead: 200_000 };
/**
 * The total of a run whose window is unknown (a run accepted before windows were frozen): the
 * 120,000 characters the material held before budgets followed the window, at four a token.
 */
const UNKNOWN_WINDOW_TOTAL = 30_000;

/**
 * The material budget of a run, from its frozen context window and whether it has `read` and
 * `bash`. A lite run binds no tools (lite-session.ts); any other run has `read` exactly when its
 * snapshot lists it, and `bash` when it lists it outside an unattended computer run (run-binding.ts,
 * computer/tool-set.ts).
 */
export function materialBudget(snapshot: RunSnapshot): MaterialBudget {
  const read = !snapshot.lite && snapshot.tools.includes('read');
  const bash =
    !snapshot.lite && !isRestrictedComputerRun(snapshot) && snapshot.tools.includes('bash');
  const window = snapshot.contextWindow;
  const total =
    window === undefined
      ? UNKNOWN_WINDOW_TOTAL
      : Math.min(
          Math.max(
            Math.floor(window * (read ? WINDOW_SHARE.read : WINDOW_SHARE.noRead)),
            MIN_TOTAL,
          ),
          read ? MAX_TOTAL.read : MAX_TOTAL.noRead,
        );
  const perFile = read ? Math.max(Math.floor(total * PER_FILE_SHARE), MIN_PER_FILE) : total;
  return { total, perFile, read, recognize: !bash };
}
