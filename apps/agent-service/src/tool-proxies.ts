import { spawn } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Type, type TSchema } from 'typebox';
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ExtensionFactory,
  type SessionManager,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import {
  DesktopCapabilitySchema,
  errorMessage,
  grantKey,
  tierAllows,
  type DesktopCapability,
  type GrantScope,
  type PermissionTier,
} from '@ai/agent-contracts';
import type { CapabilityRegistry } from './capabilities.js';
import { ConfirmStore } from './confirms.js';
import type { Logger } from './logging.js';
import { confined, inside, shellAllowlist } from './service-fs.js';

/** Host services the service tool proxies need; owned by the task runner. */
export interface ServiceToolHost {
  taskId: string;
  runId: () => string;
  executionId: () => string;
  cwd: string;
  dataDir: string;
  tier: PermissionTier;
  grants: Set<string>;
  sessions: SessionManager;
  confirms: ConfirmStore;
  capabilities: CapabilityRegistry;
  audit: (entry: Record<string, unknown>) => void;
  log: Logger;
  setStatus: (status: 'awaiting_input' | 'awaiting_confirmation' | 'running') => void;
}

/**
 * Minimal service file/shell/command proxies. Pi owns the tool protocols;
 * the service owns confinement, allowlists, tier/grant checks, confirms and
 * audit. Desktop-only abilities arrive as capability requests, never as
 * direct filesystem or clipboard access.
 */
export function serviceTools(host: ServiceToolHost): ExtensionFactory {
  const calls = new AsyncLocalStorage<string>();

  async function authorize(
    toolCallId: string,
    scope: GrantScope,
    title: string,
    detail: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const key = grantKey(scope);
    const base = { taskId: host.taskId, runId: host.runId(), tool: key, toolCallId };
    if (host.grants.has(key)) {
      host.audit({ ...base, decision: 'grant' });
      return;
    }
    if (tierAllows(host.tier, scope)) {
      host.audit({ ...base, decision: 'tier' });
      return;
    }
    host.setStatus('awaiting_confirmation');
    try {
      const answer = await host.confirms.request(
        {
          taskId: host.taskId,
          runId: host.runId(),
          executionId: host.executionId(),
          toolCallId,
          kind: 'confirmation',
          scope,
          title,
          detail: detail.slice(0, 200000),
        },
        signal,
      );
      if (!('decision' in answer) || answer.decision === 'declined') {
        host.audit({ ...base, decision: 'declined' });
        host.sessions.appendCustomEntry('app-permission', {
          toolCallId,
          runId: host.runId(),
          scope,
          outcome: 'declined',
          at: Date.now(),
        });
        throw new Error('The user declined this action.');
      }
      if (answer.decision === 'session') host.grants.add(key);
      host.audit({ ...base, decision: answer.decision });
      host.sessions.appendCustomEntry('app-permission', {
        toolCallId,
        runId: host.runId(),
        scope,
        outcome: answer.decision,
        at: Date.now(),
      });
    } finally {
      host.setStatus('running');
    }
  }

  function controlled<T extends TSchema, D, S>(
    tool: ToolDefinition<T, D, S>,
    name: 'read' | 'write' | 'edit' | 'bash',
  ): ToolDefinition<T, D, S> {
    return {
      ...tool,
      executionMode: 'sequential',
      async execute(id, args, signal, onUpdate, ctx) {
        signal?.throwIfAborted();
        const scope = scopeOf(name, args, host);
        const allow = shellAllowlist();
        if (name === 'bash') {
          const command =
            typeof (args as { command?: unknown }).command === 'string'
              ? (args as { command: string }).command.trim()
              : '';
          if (!allow.some((prefix) => command.startsWith(prefix))) {
            host.audit({
              taskId: host.taskId,
              runId: host.runId(),
              tool: 'bash',
              decision: 'allowlist_deny',
            });
            throw new Error(
              'This shell command is not on the operator allowlist (AI_AGENT_SHELL_ALLOWLIST).',
            );
          }
        }
        await authorize(id, scope, titleOf(name, args), detailOf(name, args), signal ?? undefined);
        const token = `${host.taskId}:${id}`;
        return calls.run(token, () =>
          tool.execute(id, args, signal, onUpdate, { ...ctx, cwd: host.cwd }),
        );
      },
    };
  }

  const guard = () => {
    const value = calls.getStore();
    if (!value) throw new Error('A file operation requires a tool invocation.');
    return value;
  };

  return (pi) => {
    pi.registerTool(
      controlled(
        createReadToolDefinition(host.cwd, {
          operations: {
            readFile: async (target) => {
              guard();
              const { real } = await confined(host.cwd, host.dataDir, target);
              return readFile(real);
            },
            access: async (target) => {
              guard();
              const { real } = await confined(host.cwd, host.dataDir, target);
              await stat(real);
            },
          },
        }),
        'read',
      ),
    );
    pi.registerTool(
      controlled(
        createEditToolDefinition(host.cwd, {
          operations: {
            readFile: async (target) => {
              guard();
              const { real } = await confined(host.cwd, host.dataDir, target);
              return readFile(real);
            },
            writeFile: async (target, content) => {
              guard();
              const { real } = await confined(host.cwd, host.dataDir, target);
              await writeFile(real, content);
            },
            access: async (target) => {
              guard();
              const { real } = await confined(host.cwd, host.dataDir, target);
              await stat(real);
            },
          },
        }),
        'edit',
      ),
    );
    pi.registerTool(
      controlled(
        createWriteToolDefinition(host.cwd, {
          operations: {
            writeFile: async (target, content) => {
              guard();
              const { real } = await confined(host.cwd, host.dataDir, target);
              await writeFile(real, content);
            },
            mkdir: async (target) => {
              guard();
              const { real } = await confined(host.cwd, host.dataDir, target);
              await mkdir(real, { recursive: true });
            },
          },
        }),
        'write',
      ),
    );
    pi.registerTool(
      controlled(
        createBashToolDefinition(host.cwd, {
          exposeSessionEnvironment: false,
          operations: {
            exec: (command, cwd, options) =>
              new Promise<{ exitCode: number | null }>((resolve, reject) => {
                guard();
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
        }),
        'bash',
      ),
    );
    pi.registerTool({
      name: 'command',
      label: 'Manage commands',
      description: 'Saved-command management. Unavailable until T2 delivers the command store.',
      parameters: Type.Object({ operation: Type.String() }, { additionalProperties: false }),
      executionMode: 'sequential',
      async execute() {
        return {
          content: [
            { type: 'text', text: 'Command management is unavailable until T2 (owner T2).' },
          ],
          details: {},
        };
      },
    });
    pi.registerTool({
      name: 'desktop',
      label: 'Desktop abilities',
      description:
        'Desktop-only abilities served by a connected client (file picker, selection, clipboard).',
      parameters: Type.Object(
        { capability: DesktopCapabilitySchema, input: Type.Optional(Type.Unknown()) },
        { additionalProperties: false },
      ),
      executionMode: 'sequential',
      async execute(_id, args, signal) {
        void _id;
        signal?.throwIfAborted();
        const params = args as { capability: DesktopCapability; input?: unknown };
        host.audit({
          taskId: host.taskId,
          runId: host.runId(),
          tool: `desktop:${params.capability}`,
          decision: 'request',
        });
        try {
          const value = await host.capabilities.request(
            {
              capability: params.capability,
              input: params.input ?? null,
              taskId: host.taskId,
              runId: host.runId(),
              executionId: host.executionId(),
            },
            signal ?? undefined,
          );
          return { content: [{ type: 'text', text: JSON.stringify(value) }], details: {} };
        } catch (error) {
          return {
            content: [{ type: 'text', text: `Desktop capability failed: ${errorMessage(error)}` }],
            details: {},
          };
        }
      },
    });
  };
}

function scopeOf(
  name: 'read' | 'write' | 'edit' | 'bash',
  args: unknown,
  host: ServiceToolHost,
): GrantScope {
  if (name === 'bash') return { tool: 'bash' };
  const target =
    typeof (args as { path?: unknown }).path === 'string' ? (args as { path: string }).path : '';
  const absolute = path.resolve(host.cwd, target);
  return { tool: name, location: inside(host.cwd, absolute) ? 'inside' : 'outside' };
}

function titleOf(name: string, args: unknown): string {
  const record = (args ?? {}) as Record<string, unknown>;
  if (name === 'bash' && typeof record.command === 'string')
    return `Run: ${record.command.slice(0, 200)}`;
  if (typeof record.path === 'string') return `${name}: ${record.path.slice(0, 300)}`;
  return `${name} operation`;
}

function detailOf(name: string, args: unknown): string {
  try {
    return JSON.stringify({ tool: name, args });
  } catch {
    return name;
  }
}

// T4 MCP proxy registration (exclusive owner T4): runner MCP tools register
// through the authority facade only; skills stay untouched. T34int composes
// the prepared factory from prepareMcpTools alongside serviceTools.
export { mcpProxyName, prepareMcpTools } from './mcp/tool-proxies.js';
export type { McpProxyDetails, McpProxyHost, McpProxyOptions } from './mcp/tool-proxies.js';
