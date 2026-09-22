import { spawn } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { Type } from 'typebox';
import { checkChildPath, isChildToolAllowed } from './intersection.js';
import { releaseWrite, tryAcquireWrite } from './registry.js';

/**
 * T5 child tool proxies. The required bridge registers these confined tools
 * in every foreground child: service dataDir confinement, operator shell
 * allowlist, no parallel same-file writes, explicit blocks. Child writes stay
 * inside the task output dir; outside paths are blocked without a prompt.
 */

export interface ChildToolHost {
  taskId: string;
  parentRunId: string;
  executionId: string;
  cwd: string;
  dataDir: string;
  allowedTools: string[];
  resourceIds: string[];
  audit: (entry: Record<string, unknown>) => void;
}

interface PiLike {
  registerTool(tool: {
    name: string;
    label: string;
    description: string;
    parameters: unknown;
    execute: (
      id: string,
      args: unknown,
      signal?: AbortSignal,
    ) => Promise<{ content: { type: string; text: string }[]; details: unknown }>;
  }): void;
  on(
    event: 'tool_call',
    handler: (event: { toolName: string }) => { block?: boolean; reason?: string } | undefined,
  ): void;
}

function shellAllowlist(): string[] {
  return (process.env.AI_AGENT_SHELL_ALLOWLIST ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

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
export function registerChildCeiling(pi: PiLike, host: ChildToolHost): void {
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

/** Registers confined read/write/edit/bash/command proxies for one child. */
export function registerChildTools(pi: PiLike, host: ChildToolHost): void {
  registerChildCeiling(pi, host);
  if (host.allowedTools.includes('read')) {
    pi.registerTool({
      name: 'read',
      label: 'Read a file',
      description: 'Read a file inside the task output or a ledger resource.',
      parameters: Type.Object({ path: Type.String() }),
      async execute(_id, args) {
        void _id;
        const target = (args as { path?: unknown }).path;
        if (typeof target !== 'string' || !target)
          throw denied(host, 'read', 'A path is required.');
        const { real, location } = await checkChildPath({
          cwd: host.cwd,
          dataDir: host.dataDir,
          rawPath: target,
        });
        if (location === 'outside' && !isResourcePath(host, real))
          throw denied(host, 'read', 'Child reads outside the task output are blocked.');
        host.audit({
          taskId: host.taskId,
          runId: host.parentRunId,
          executionId: host.executionId,
          tool: 'read',
          decision: 'allow',
        });
        await stat(real);
        const text = await readFile(real, 'utf8');
        return { content: [{ type: 'text', text }], details: {} };
      },
    });
  }
  if (host.allowedTools.includes('write') || host.allowedTools.includes('edit')) {
    const writeOne = async (tool: string, target: unknown, content: unknown) => {
      if (typeof target !== 'string' || !target) throw denied(host, tool, 'A path is required.');
      if (typeof content !== 'string') throw denied(host, tool, 'Content must be text.');
      const { real, location } = await checkChildPath({
        cwd: host.cwd,
        dataDir: host.dataDir,
        rawPath: target,
      });
      if (location === 'outside')
        throw denied(host, tool, 'Child writes outside the task output are blocked.');
      const lock = tryAcquireWrite(host.taskId, real, host.executionId);
      if (!lock.ok)
        throw denied(host, tool, `Parallel write to ${target} is blocked; a sibling holds it.`);
      try {
        await mkdir(real.split('/').slice(0, -1).join('/') || host.cwd, { recursive: true });
        await writeFile(real, content);
      } finally {
        releaseWrite(host.taskId, real, host.executionId);
      }
      host.audit({
        taskId: host.taskId,
        runId: host.parentRunId,
        executionId: host.executionId,
        tool,
        decision: 'allow',
      });
      return { content: [{ type: 'text', text: `Wrote ${target}.` }], details: {} };
    };
    if (host.allowedTools.includes('write')) {
      pi.registerTool({
        name: 'write',
        label: 'Write a file',
        description: 'Write a file inside the task output dir.',
        parameters: Type.Object({ path: Type.String(), content: Type.String() }),
        async execute(_id, args) {
          void _id;
          const record = args as { path?: unknown; content?: unknown };
          return writeOne('write', record.path, record.content);
        },
      });
    }
    if (host.allowedTools.includes('edit')) {
      pi.registerTool({
        name: 'edit',
        label: 'Edit a file',
        description: 'Replace file content inside the task output dir.',
        parameters: Type.Object({ path: Type.String(), content: Type.String() }),
        async execute(_id, args) {
          void _id;
          const record = args as { path?: unknown; content?: unknown };
          return writeOne('edit', record.path, record.content);
        },
      });
    }
  }
  if (host.allowedTools.includes('bash')) {
    pi.registerTool({
      name: 'bash',
      label: 'Run a shell command',
      description: 'Run an allowlisted shell command in the task output dir.',
      parameters: Type.Object({ command: Type.String() }),
      async execute(_id, args, signal) {
        void _id;
        signal?.throwIfAborted();
        const command = (args as { command?: unknown }).command;
        if (typeof command !== 'string' || !command.trim())
          throw denied(host, 'bash', 'A command is required.');
        const allow = shellAllowlist();
        if (!allow.some((prefix) => command.trim().startsWith(prefix)))
          throw denied(host, 'bash', 'This shell command is not on the operator allowlist.');
        host.audit({
          taskId: host.taskId,
          runId: host.parentRunId,
          executionId: host.executionId,
          tool: 'bash',
          decision: 'allow',
        });
        const output = await runCommand(command, host.cwd, signal);
        return { content: [{ type: 'text', text: output }], details: {} };
      },
    });
  }
  if (host.allowedTools.includes('command')) {
    pi.registerTool({
      name: 'command',
      label: 'Manage commands',
      description: 'Saved-command management. Unavailable until T2 delivers the command store.',
      parameters: Type.Object({ operation: Type.String() }),
      async execute() {
        return {
          content: [
            { type: 'text', text: 'Command management is unavailable until T2 (owner T2).' },
          ],
          details: {},
        };
      },
    });
  }
}

function isResourcePath(host: ChildToolHost, real: string): boolean {
  if (!host.resourceIds.length) return false;
  return host.resourceIds.some(
    (id) => real.endsWith(`/${id}`) || real.includes(`/resources/${id}`),
  );
}

function runCommand(command: string, cwd: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, timeout: 120000 });
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    signal?.addEventListener('abort', () => child.kill(), { once: true });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(output.slice(0, 200000));
      else reject(new Error(`The command exited with code ${code ?? 'unknown'}.`));
    });
  });
}
