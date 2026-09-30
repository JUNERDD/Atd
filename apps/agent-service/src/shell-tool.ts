import {
  createBashToolDefinition,
  createLocalBashOperations,
  type BashOperations,
} from '@earendil-works/pi-coding-agent';
import type { PermissionTier } from '@ai/agent-contracts';
import type { Gate } from './harness/gate.js';
import { authorizeShellCommand } from './shell-policy.js';
import type { ToolInvocation } from './tool-proxies.js';

/** What the parent bash tool needs from its host (`ServiceToolHost` satisfies it). */
export interface ShellToolHost {
  taskId: string;
  runId: () => string;
  cwd: string;
  tier: PermissionTier;
  audit: (entry: Record<string, unknown>) => void;
}

/**
 * The longest one shell command runs, in seconds (pi's unit for a bash `timeout`). Service
 * policy: the model may ask for less, never for more. Subagent children share it.
 */
export const SHELL_TIMEOUT_CEILING_SECONDS = 120;

const local = createLocalBashOperations();

/**
 * Runs a command on pi's own local bash backend under the service ceiling. The parent's and every
 * child's bash go through it. It replaced a hand-rolled `spawn(command, { shell: true })`, so
 * these things changed on purpose:
 * - The shell is bash (`/bin/bash`, else `bash` on PATH, `sh` only as a last resort), not
 *   `/bin/sh`: the model is offered this tool as bash.
 * - The environment is pi's shell env: the process environment with pi's bin directory first on
 *   PATH. The parent's tool also passes `options.env` without pi's session variables
 *   (`PI_SESSION_ID`, `PI_MODEL`, ...); a child gets the plain shell env.
 * - The command leads its own process group, and Stop (the abort signal) or the timeout kills the
 *   whole group. The old exec ignored the signal, so Stop waited for the command to end, and its
 *   120 s limit only signalled the shell.
 * - The model's `timeout` counts, up to the ceiling, where the old exec ignored it. Abort and
 *   timeout reject with `aborted` and `timeout:<seconds>`, which pi's bash tool turns into a
 *   "Command aborted" or "Command timed out after N seconds" error that keeps the output so far.
 */
export const boundedExec: BashOperations['exec'] = (command, cwd, options) =>
  local.exec(command, cwd, {
    ...options,
    timeout: Math.min(
      options.timeout ?? SHELL_TIMEOUT_CEILING_SECONDS,
      SHELL_TIMEOUT_CEILING_SECONDS,
    ),
  });

/**
 * The parent's bash tool: pi's bash with a service-owned `exec`, decided by the shell policy
 * (`authorizeShellCommand`, the same decision children make).
 */
export function bashToolDefinition(
  host: ShellToolHost,
  gate: Gate,
  invocation: ToolInvocation,
): ReturnType<typeof createBashToolDefinition> {
  const tool = createBashToolDefinition(host.cwd, {
    exposeSessionEnvironment: false,
    operations: {
      // The guard refuses an exec that pi reached outside a tool invocation.
      exec: async (command, cwd, options) => {
        invocation.guard();
        return boundedExec(command, cwd, options);
      },
    },
  });
  return {
    ...tool,
    executionMode: 'sequential',
    async execute(id, args, signal, onUpdate, ctx) {
      signal?.throwIfAborted();
      await authorizeShellCommand({
        command: args.command,
        toolCallId: id,
        tier: host.tier,
        gate,
        signal: signal ?? undefined,
        detail: JSON.stringify({ tool: 'bash', args }),
        auditAllowlisted: () =>
          host.audit({
            taskId: host.taskId,
            runId: host.runId(),
            tool: 'bash',
            toolCallId: id,
            decision: 'allowlist',
          }),
      });
      return invocation.run(id, () =>
        tool.execute(id, args, signal, onUpdate, { ...ctx, cwd: host.cwd }),
      );
    },
  };
}
