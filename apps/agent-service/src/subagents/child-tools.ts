import {
  createBashToolDefinition,
  createWriteToolDefinition,
  type ExtensionAPI,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { TSchema } from 'typebox';
import { childCommandTool } from '../commands/tool.js';
import { loaderReadTool, type HintResolver } from '../file-loader/read-tool.js';
import { createAtdEditToolDefinition } from '../file-tools/edit-tool.js';
import { observedPath } from '../file-view/call.js';
import { FileViews } from '../file-view/tools.js';
import { childSearchTools } from '../harness/search/tools.js';
import { childWebTools } from '../harness/web-extension.js';
import { resourceIdAt } from '../service-fs.js';
import { authorizeShellCommand } from '../shell-policy.js';
import { boundedExec } from '../shell-tool.js';
import { servicePaths } from '../storage.js';
import { editOperations, writeOperations, type ResolvePath } from '../tool-proxies.js';
import { checkChildPath, isChildToolAllowed } from './intersection.js';
import { hostForTask } from './registry.js';

/**
 * T5 child tool proxies. The required bridge registers these confined tools
 * in every foreground child: service dataDir confinement, the service shell
 * policy, the File View Ledger the child shares with its parent (file-view/),
 * explicit blocks. Child writes stay inside the task output dir; outside paths
 * are blocked without a prompt.
 * read/write/edit/bash are pi's own tools, built on the parent's operation
 * builders (tool-proxies.ts, the file loader's read in file-loader/read-tool.ts)
 * with the child's path decision; grep/find/ls are
 * the parent's confined pi tools (harness/search), and web_search/fetch_content
 * the parent's keyless web tools (harness/web-extension).
 *
 * bash, command saves and web calls decide exactly as the parent's do: through the
 * parent task's tier and the service gate (`SubagentHost.approvals`), with
 * confirms attributed to the child's execution id. A child's abort signal
 * cancels its pending confirm wait.
 */

export interface ChildToolHost {
  taskId: string;
  parentRunId: string;
  executionId: string;
  /** The child's runtime agent name, which may make its approvals stricter. */
  agent: string;
  cwd: string;
  dataDir: string;
  allowedTools: string[];
  resourceIds: string[];
  audit: (entry: Record<string, unknown>) => void;
}

/** What a service child tool answers; `childDefinition` hands it to pi as text content. */
export interface ChildToolResult {
  content: { type: string; text: string }[];
  details: unknown;
  /** A failed call whose text is still returned, such as a command's output. */
  isError?: boolean;
}

/**
 * A service tool shared with children (search, web, command) before it becomes a pi tool
 * definition; its arguments are checked against `parameters` by pi and again by the tool.
 */
export interface ChildTool {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  execute: (id: string, args: unknown, signal?: AbortSignal) => Promise<ChildToolResult>;
}

/** What the child tools use of a child's `pi`; the bridge hands over the real one. */
export type ChildPi = Pick<ExtensionAPI, 'on' | 'registerTool'>;

function denied(host: ChildToolHost, tool: string, reason: string): Error {
  host.audit({
    taskId: host.taskId,
    runId: host.parentRunId,
    executionId: host.executionId,
    tool,
    decision: 'deny',
    reason: reason.slice(0, 500),
  });
  return new Error(reason);
}

/** Registers the ceiling gate: names outside the ceiling never execute. */
export function registerChildCeiling(pi: ChildPi, host: ChildToolHost): void {
  pi.on('tool_call', (event) => {
    if (isChildToolAllowed(host.allowedTools, event.toolName)) return undefined;
    host.audit({
      taskId: host.taskId,
      runId: host.parentRunId,
      executionId: host.executionId,
      tool: event.toolName,
      decision: 'ceiling_deny',
    });
    return { block: true, reason: `Tool ${event.toolName} is not in the child ceiling.` };
  });
}

/** Registers confined file, shell, command, search and web proxies for one child. */
export function registerChildTools(pi: ChildPi, host: ChildToolHost): void {
  registerChildCeiling(pi, host);
  const parent = hostForTask(host.taskId);
  if (!parent) throw new Error('Child tools have no host record for this task; refusing to start.');
  const approvals = parent.approvals({
    runId: host.parentRunId,
    executionId: host.executionId,
    agent: host.agent,
  });
  const allow = (tool: string, decision = 'allow') =>
    host.audit({
      taskId: host.taskId,
      runId: host.parentRunId,
      executionId: host.executionId,
      tool,
      decision,
    });
  const tools: ChildTool[] = [
    ...childSearchTools(host.cwd, host.allowedTools, allow),
    ...childWebTools(approvals.gate, host.allowedTools),
  ];
  if (host.allowedTools.includes('command'))
    tools.push(
      childCommandTool(host.dataDir, approvals.gate, (decision) => allow('command', decision)),
    );
  for (const tool of tools) pi.registerTool(childDefinition(tool));
  registerFileTools(pi, host, parent.resourceHint);
  if (host.allowedTools.includes('bash')) {
    const bash = createBashToolDefinition(host.cwd, {
      exposeSessionEnvironment: false,
      operations: { exec: boundedExec },
    });
    pi.registerTool({
      ...bash,
      async execute(id, args, signal, onUpdate, ctx) {
        signal?.throwIfAborted();
        await authorizeShellCommand({
          command: args.command,
          toolCallId: id,
          tier: approvals.tier,
          gate: approvals.gate,
          signal,
          detail: JSON.stringify({ tool: 'bash', args }),
          auditAllowlisted: () => allow('bash', 'allowlist'),
        });
        return bash.execute(id, args, signal, onUpdate, ctx);
      },
    });
  }
}

/** A service child tool as a pi tool definition; its text-only result passes through. */
function childDefinition(tool: ChildTool): ToolDefinition {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    async execute(id, args, signal) {
      const result = await tool.execute(id, args, signal);
      return {
        content: result.content.map((part) => ({ type: 'text' as const, text: part.text })),
        details: result.details,
        ...(result.isError ? { isError: true } : {}),
      };
    },
  };
}

/**
 * pi's read, write and edit for one child. `checkChildPath` decides every path the operations
 * touch: reads stay in the task output or a ledger resource, writes and edits in the task output
 * (an edit only reads files it may write). The child is a session of the task's File View Ledger
 * (file-view/), as the parent is: it may overwrite only a file it saw as it is now, and a sibling's
 * write makes its view stale. pi's per-file mutation queue keeps parallel children from writing
 * one file at the same time (tool-proxies.ts `editOperations`). A call is audited once it
 * succeeds; a refused path is audited as a denial.
 */
function registerFileTools(pi: ChildPi, host: ChildToolHost, resourceHint: HintResolver): void {
  const views = new FileViews({
    taskId: host.taskId,
    role: 'child',
    sessionId: () => `child:${host.executionId}`,
  });
  views.register(pi);
  const readable =
    (tool: string): ResolvePath =>
    async (target) => {
      const { real, location } = await checkChildPath({
        cwd: host.cwd,
        dataDir: host.dataDir,
        rawPath: target,
      });
      if (location === 'outside' && !(await isResourcePath(host, real)))
        throw denied(host, tool, 'Child reads outside the task output are blocked.');
      return real;
    };
  const writable =
    (tool: string): ResolvePath =>
    async (target) => {
      const { real, location } = await checkChildPath({
        cwd: host.cwd,
        dataDir: host.dataDir,
        rawPath: target,
        write: true,
      });
      if (location === 'outside')
        throw denied(host, tool, 'Child writes outside the task output are blocked.');
      return real;
    };
  const register = <T extends TSchema, D, S>(tool: ToolDefinition<T, D, S>): void => {
    if (host.allowedTools.includes(tool.name)) pi.registerTool(audited(host, tool));
  };
  const reads = readable('read');
  const read = loaderReadTool(host.cwd, observedPath(reads), resourceHint);
  register(views.read(read, host.cwd, reads));
  const writes = writeOperations(writable('write'));
  register(views.write(createWriteToolDefinition(host.cwd, { operations: writes })));
  const edits = editOperations(writable('edit'), writable('edit'));
  register(views.edit(createAtdEditToolDefinition(host.cwd, { operations: edits })));
}

/** Audits a pi tool's call once it returns; pi's tool context passes through untouched. */
function audited<T extends TSchema, D, S>(
  host: ChildToolHost,
  tool: ToolDefinition<T, D, S>,
): ToolDefinition<T, D, S> {
  return {
    ...tool,
    async execute(id, args, signal, onUpdate, ctx) {
      signal?.throwIfAborted();
      const result = await tool.execute(id, args, signal, onUpdate, ctx);
      host.audit({
        taskId: host.taskId,
        runId: host.parentRunId,
        executionId: host.executionId,
        tool: tool.name,
        decision: 'allow',
      });
      return result;
    },
  };
}

/** Whether the real path `real` is the file of one of the run's ledger resources. */
async function isResourcePath(host: ChildToolHost, real: string): Promise<boolean> {
  if (!host.resourceIds.length) return false;
  const id = await resourceIdAt(servicePaths(host.dataDir).resourcesDir, host.cwd, real);
  return id !== null && host.resourceIds.includes(id);
}
