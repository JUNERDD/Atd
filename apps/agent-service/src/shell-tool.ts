import { spawn } from 'node:child_process';
import { createBashToolDefinition } from '@earendil-works/pi-coding-agent';
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
      exec: (command, cwd, options) =>
        new Promise<{ exitCode: number | null }>((resolve, reject) => {
          invocation.guard();
          const child = spawn(command, { cwd, shell: true, timeout: 120000 });
          let settled = false;
          const finish = (value: { exitCode: number | null }) => {
            if (settled) return;
            settled = true;
            resolve(value);
          };
          child.stdout?.on('data', (chunk: Buffer) => options.onData(chunk));
          child.stderr?.on('data', (chunk: Buffer) => options.onData(chunk));
          child.on('error', (error) => {
            if (!settled) {
              settled = true;
              reject(error);
            }
          });
          child.on('close', (code) => finish({ exitCode: code }));
        }),
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
