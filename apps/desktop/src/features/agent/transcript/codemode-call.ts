import { createContext } from 'react';
import type { CodemodeStep, CodemodeStepDetails } from '@ai/agent-contracts';
import type { ConfirmationRequest } from '../../../client/agent/permission-schema';
import type { BlockOf, ToolDetails } from '../../../client/agent/transcript-schema';

/**
 * A `codemode` call: the model's script (`args.code`) and the tool calls it made, which the
 * service projects as `details.data.steps` in every status. Each step renders as the row a direct
 * call of that tool would get, so it is shaped here as that call's tool block.
 */

/** The first line of a script `// @options:` may start with; it configures, it does not act. */
const OPTIONS_LINE = /^\s*\/\/\s*@options:/;

/** The script source, or empty while the model is still writing the call. */
export function codemodeSource(args: Record<string, unknown>): string {
  return typeof args.code === 'string' ? args.code : '';
}

/** The row target: the script's first line that does something, like a shell call's first line. */
export function codemodeTarget(args: Record<string, unknown>): string | null {
  const line = codemodeSource(args)
    .split('\n')
    .map((item) => item.trim())
    .find((item) => item && !OPTIONS_LINE.test(item));
  return line ?? null;
}

/**
 * A nested call as the tool block of a direct call: the same row, label, target, body and
 * permission note. Its id stays under the parent's, so React keys and expansion stay per step.
 */
export function codemodeStepBlock(parent: BlockOf<'tool'>, step: CodemodeStep): BlockOf<'tool'> {
  return {
    kind: 'tool',
    id: `${parent.id}/${step.id}`,
    runId: parent.runId,
    timestamp: parent.timestamp,
    endedAt: parent.endedAt,
    callId: step.id,
    name: step.name,
    args: step.args,
    status: step.status,
    output: step.output,
    partial: '',
    details: stepDetails(step.details),
    permission: step.permission
      ? { scope: step.permission.scope, outcome: step.permission.outcome }
      : null,
  };
}

/** The desktop's details split, as `mapToolDetails` makes it: an edit diff has its own field. */
function stepDetails(details: CodemodeStepDetails | undefined): ToolDetails {
  const none: ToolDetails = { diff: '', truncated: false, fullOutputPath: '' };
  if (!details) return none;
  if (details.type === 'diff') return { ...none, diff: details.diff, truncated: details.truncated };
  return { ...none, data: details };
}

/**
 * The pending request of a nested call (`<codemode call id>/<n>`), which turns.ts indexes under
 * the script's row; that row's `ToolBlock` provides it to its body, so the step that asks shows
 * it. Undefined everywhere else.
 */
export const NestedConfirmation = createContext<ConfirmationRequest | undefined>(undefined);
