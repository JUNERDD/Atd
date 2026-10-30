import type { JsonValue } from '@earendil-works/pi-ai';
import {
  createBashToolDefinition,
  createLocalBashOperations,
  type AgentToolResult,
  type BashOperations,
  type BashToolDetails,
} from '@earendil-works/pi-coding-agent';
import type { PermissionTier } from '@atd/agent-contracts';
import type { Gate } from './harness/gate.js';
import type { Logger } from './logging.js';
import type { ResourceStore, TaskResources } from './resources.js';
import { authorizeShellCommand } from './shell-policy.js';
import {
  keepSpill,
  RESOURCE_LIMIT,
  type KeptSpill,
  type SpillHost,
  type SpillKind,
} from './spilled-output.js';
import type { ToolInvocation } from './tool-proxies.js';

/** What the parent bash tool needs from its host (`ServiceToolHost` satisfies it). */
export interface ShellToolHost {
  taskId: string;
  runId: () => string;
  cwd: string;
  tier: PermissionTier;
  audit: (entry: Record<string, unknown>) => void;
  /** Where the full text of output pi cut is kept: a task resource in `taskResources.dir`. */
  resources: Pick<ResourceStore, 'save'>;
  taskResources: Pick<TaskResources, 'dir'>;
  log: Pick<Logger, 'warn'>;
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
      const spills: SpillHost = { ...host, resourcesDir: host.taskResources.dir };
      // Pi's context goes through untouched; see `controlled` in tool-proxies.ts.
      return keepingFullOutput(spills, () =>
        invocation.run(id, () => tool.execute(id, args, signal, onUpdate, ctx)),
      );
    },
  };
}

/**
 * pi's file with a cut bash output's full text (`core/tools/output-accumulator.js`). Output too
 * large for the resource store stays in pi's file, which bash can still open.
 */
const BASH_SPILL: SpillKind = {
  file: /^pi-bash-[0-9a-f]+\.log$/,
  name: 'bash-output.log',
  mime: 'text/plain',
  label: 'Bash output',
  leaveOversize: true,
};

/** pi's notice naming that file, at the end of the output it cut. */
const FULL_OUTPUT = /Full output: (.+?\/pi-bash-[0-9a-f]+\.log)\]/;

/**
 * Runs a bash call and keeps the full text of output pi cut in the task's resources
 * (spilled-output.ts), so `read` and `grep` reach it without a confirmation and it goes with the
 * task. pi names its temp file in the notice (`Full output: <path>`), in `details` and in the
 * structured output codemode scripts read; all three then name the kept file, or say why there is
 * none. Output over the resource limit stays in pi's temp file, which all three keep naming, and
 * the notice says why. A failed command (abort, timeout, no exit code) rejects with that notice in
 * its message.
 */
export async function keepingFullOutput(
  host: SpillHost,
  run: () => Promise<AgentToolResult<BashToolDetails | undefined>>,
): Promise<AgentToolResult<BashToolDetails | undefined>> {
  let result: AgentToolResult<BashToolDetails | undefined>;
  try {
    result = await run();
  } catch (error) {
    const spilled = error instanceof Error ? FULL_OUTPUT.exec(error.message)?.[1] : undefined;
    if (!spilled || !(error instanceof Error)) throw error;
    throw new Error(renamed(error.message, spilled, await keepSpill(host, spilled, BASH_SPILL)));
  }
  const spilled = result.details?.fullOutputPath;
  if (!spilled) return result;
  const kept = await keepSpill(host, spilled, BASH_SPILL);
  const keptPath = kept && 'path' in kept ? kept.path : undefined;
  const { fullOutputPath: _, ...details } = result.details ?? {};
  const { structuredContent, ...rest } = result;
  return {
    ...rest,
    content: result.content.map((part) =>
      part.type === 'text' ? { ...part, text: renamed(part.text, spilled, kept) } : part,
    ),
    details: keptPath ? { ...details, fullOutputPath: keptPath } : details,
    ...(structuredContent === undefined
      ? {}
      : { structuredContent: withPath(structuredContent, keptPath) }),
  };
}

/** Why a bash output's full text stayed in pi's file in the system temp folder. */
const TOO_LARGE = `too large to keep with the task, over the ${RESOURCE_LIMIT} resource limit; it stays in the system temp folder, where only bash can open it`;

/**
 * `text` with pi's notice pointing at the kept file, saying why the full output stayed in pi's
 * temp file, or why it is gone.
 */
function renamed(text: string, spilled: string, kept: KeptSpill): string {
  const notice = `Full output: ${spilled}`;
  if (kept && 'path' in kept && kept.tooLarge)
    return text.replaceAll(notice, `${notice} (${TOO_LARGE})`);
  if (kept && 'path' in kept) return text.replaceAll(notice, `Full output: ${kept.path}`);
  return text.replaceAll(notice, `Full output not kept${kept ? `: ${kept.error}` : ''}`);
}

/**
 * pi's structured bash output with its `full_output_path` (set when that output was cut too) at
 * the kept file, or without it.
 */
function withPath(structured: JsonValue, kept: string | undefined): JsonValue {
  if (!structured || typeof structured !== 'object' || isList(structured)) return structured;
  if (!('full_output_path' in structured)) return structured;
  const { full_output_path: _, ...rest } = structured;
  return kept ? { ...rest, full_output_path: kept } : rest;
}

function isList(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}
