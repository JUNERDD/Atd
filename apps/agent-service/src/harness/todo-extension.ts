import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { TODO_TOOL } from '@ai/agent-contracts';
import type { HarnessDeps } from './deps.js';
import { loadRpivTodo } from './todo/loader.js';

/**
 * `todo`: the pinned rpiv-todo extension (harness/todo/loader.ts), registered unchanged on the
 * parent session. rpiv-todo owns the tool, its per-session state and the branch replay on
 * `session_start` / `session_compact` / `session_tree`: the latest successful `todo` tool result
 * on the branch is the list, so resume, rebuild and branch switches restore it. Its TUI overlay
 * and `/todos` command stay inert here (no UI; prompts are sent without command expansion).
 * Children never get the tool (run-binding / subagent rules).
 */
export function todoExtension(deps: HarnessDeps): ExtensionFactory {
  return async (pi) => {
    const register = await loadRpivTodo().catch((error: unknown) => {
      // Pi only reports that an extension failed; keep the cause in the service log.
      deps.runner.ctx.log.error('The todo extension could not be loaded.', {
        taskId: deps.runner.taskId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    });
    register(pi);
    // rpiv-todo reports a rejected mutation (missing subject, unknown id, illegal transition,
    // dependency cycle) as an ordinary result with `details.error` and "Error: …" text. Flag it
    // as an error for the model and the transcript; content and details stay as they are, so the
    // unchanged snapshot still replays.
    pi.on('tool_result', (event) => {
      if (event.toolName !== TODO_TOOL || event.isError || !isRejected(event.details)) return;
      return { isError: true };
    });
  };
}

/** rpiv-todo `TaskDetails.error`: present only when the reducer rejected the call. */
function isRejected(details: unknown): boolean {
  return typeof details === 'object' && details !== null && 'error' in details
    ? typeof details.error === 'string'
    : false;
}
