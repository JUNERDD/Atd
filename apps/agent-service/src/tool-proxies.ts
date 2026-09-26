import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import type { TSchema } from 'typebox';
import {
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ExtensionFactory,
  type SessionManager,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { GrantScope, McpServerConfig, PermissionTier } from '@ai/agent-contracts';
import type { CapabilityRegistry } from './capabilities.js';
import { commandToolDefinition } from './commands/tool.js';
import { registerConfigureMcpTool } from './configure-mcp-tool.js';
import { ConfirmStore } from './confirms.js';
import { registerDesktopTool } from './desktop-tool.js';
import type { Reviewer } from './harness/auto-review.js';
import { createGate } from './harness/gate.js';
import type { Logger } from './logging.js';
import {
  confined,
  inside,
  resolveToolPath,
  userAgentsReadRoots,
  withinRoots,
} from './service-fs.js';
import { bashToolDefinition } from './shell-tool.js';

/** Host services the service tool proxies need; owned by the task runner. */
export interface ServiceToolHost {
  taskId: string;
  runId: () => string;
  executionId: () => string;
  cwd: string;
  dataDir: string;
  tier: PermissionTier;
  grants: Set<string>;
  review: Reviewer;
  sessions: SessionManager;
  confirms: ConfirmStore;
  capabilities: CapabilityRegistry;
  audit: (entry: Record<string, unknown>) => void;
  log: Logger;
  setStatus: (status: 'awaiting_input' | 'awaiting_confirmation' | 'running') => void;
  /**
   * Directories of the skills the current run loaded. They are the run's read-only material:
   * the read tool reads inside them without a confirmation; writes keep the usual rules.
   */
  skillDirs: () => readonly string[];
  configureMcp?: (servers: McpServerConfig[]) => Promise<McpServerConfig[]>;
  configuredMcp?: () => McpServerConfig[];
}

/**
 * Marks file and shell operations as part of one tool invocation: pi's operations run only inside
 * `run`, and `guard` refuses an operation reached any other way.
 */
export interface ToolInvocation {
  run<T>(toolCallId: string, operation: () => T): T;
  guard(): string;
}

/**
 * Minimal service file/shell/command proxies. Pi owns the tool protocols;
 * the service owns confinement here, the shell policy in shell-tool.ts, and
 * tier/grant checks, confirms and audit in the shared gate (harness/gate.ts).
 * Desktop-only abilities arrive as capability requests, never as direct
 * filesystem or clipboard access.
 */
export function serviceTools(host: ServiceToolHost): ExtensionFactory {
  const calls = new AsyncLocalStorage<string>();
  const invocation: ToolInvocation = {
    run: (toolCallId, operation) => calls.run(`${host.taskId}:${toolCallId}`, operation),
    guard: () => {
      const value = calls.getStore();
      if (!value) throw new Error('A file operation requires a tool invocation.');
      return value;
    },
  };
  const guard = invocation.guard;

  const authorize = createGate(host);

  /**
   * Whether a read targets a directory of the current run's skills. Their files are read-only
   * material the run was given, so reading them needs no confirmation.
   */
  async function readsRunSkill(args: unknown): Promise<boolean> {
    const target = pathOf(args);
    return target !== '' && (await withinRoots(host.skillDirs(), host.cwd, target));
  }

  /** Roots only the read tool may reach beyond the data directory (service-fs.ts `confined`). */
  async function readRoots(): Promise<string[]> {
    return [...(await userAgentsReadRoots()), ...host.skillDirs()];
  }

  function controlled<T extends TSchema, D, S>(
    tool: ToolDefinition<T, D, S>,
    name: 'read' | 'write' | 'edit',
  ): ToolDefinition<T, D, S> {
    return {
      ...tool,
      executionMode: 'sequential',
      async execute(id, args, signal, onUpdate, ctx) {
        signal?.throwIfAborted();
        const scope = scopeOf(name, args, host);
        if (name === 'read' && (await readsRunSkill(args))) {
          const base = { taskId: host.taskId, runId: host.runId(), toolCallId: id };
          host.audit({ ...base, tool: 'read:skill', decision: 'skill' });
        } else {
          // A path the operation would refuse fails before the gate, so no prompt or review
          // is spent on a call that cannot run.
          await confined(
            host.cwd,
            host.dataDir,
            resolveToolPath(host.cwd, pathOf(args)),
            name === 'read' ? await readRoots() : [],
          );
          await authorize({
            toolCallId: id,
            scope,
            title: titleOf(name, args),
            detail: detailOf(name, args),
            signal: signal ?? undefined,
          });
        }
        return invocation.run(id, () =>
          tool.execute(id, args, signal, onUpdate, { ...ctx, cwd: host.cwd }),
        );
      },
    };
  }

  return (pi) => {
    pi.registerTool(
      controlled(
        createReadToolDefinition(host.cwd, {
          operations: {
            readFile: async (target) => {
              guard();
              const { real } = await confined(host.cwd, host.dataDir, target, await readRoots());
              return readFile(real);
            },
            access: async (target) => {
              guard();
              const { real } = await confined(host.cwd, host.dataDir, target, await readRoots());
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
    pi.registerTool(bashToolDefinition(host, authorize, invocation));
    pi.registerTool(commandToolDefinition(host.dataDir, authorize));
    registerDesktopTool(pi, host);
    registerConfigureMcpTool(pi, host);
  };
}

function scopeOf(
  name: 'read' | 'write' | 'edit',
  args: unknown,
  host: ServiceToolHost,
): GrantScope {
  const absolute = resolveToolPath(host.cwd, pathOf(args));
  return { tool: name, location: inside(host.cwd, absolute) ? 'inside' : 'outside' };
}

/** The file path a file tool call names; empty when it names none. */
function pathOf(args: unknown): string {
  const value = (args as { path?: unknown }).path;
  return typeof value === 'string' ? value : '';
}

function titleOf(name: string, args: unknown): string {
  const record = (args ?? {}) as Record<string, unknown>;
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
