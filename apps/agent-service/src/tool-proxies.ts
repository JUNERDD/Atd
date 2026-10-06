import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import type { TSchema } from 'typebox';
import {
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  detectSupportedImageMimeTypeFromFile,
  type EditOperations,
  type ExtensionFactory,
  type ReadOperations,
  type SessionManager,
  type ToolDefinition,
  type WriteOperations,
} from '@earendil-works/pi-coding-agent';
import type { GrantScope, PermissionTier } from '@atd/agent-contracts';
import {
  catalogConfirmedWrite,
  catalogDeferredFolders,
  catalogTarget,
  type WriteCall,
} from './atd-agents/catalog-writes.js';
import type { CapabilityRegistry } from './capabilities.js';
import { commandToolDefinition } from './commands/tool.js';
import { registerMcpCatalogTools, type ListMcp, type UpsertMcp } from './configure-mcp-tool.js';
import { ConfirmStore } from './confirms.js';
import { registerDesktopTool } from './desktop-tool.js';
import type { Reviewer } from './harness/auto-review.js';
import { inGrantedFolder } from './folders/access.js';
import { createGate } from './harness/gate.js';
import type { Logger } from './logging.js';
import type { TaskResources } from './resources.js';
import {
  confined,
  confinedWrite,
  inside,
  resolveToolPath,
  resourceIdAt,
  userAgentsReadRoots,
  withinRoots,
} from './service-fs.js';
import { bashToolDefinition } from './shell-tool.js';
import { auditWrote } from './unattended.js';

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
  /**
   * Whether the current run is unattended (unattended.ts): the gate declines what it would ask,
   * and the desktop and `configure_mcp` tools refuse.
   */
  unattended: () => boolean;
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
  /**
   * The task's own resources: codemode's spilled output, an MCP result's whole text, the run's
   * attachments. The read tool reads them without a confirmation, since the task made or was given
   * them; other tasks' resources and the rest of the data dir keep the usual rules.
   */
  taskResources: TaskResources;
  /**
   * Realpaths of the folders the task was granted, as the current run started: read-only
   * material the read tool (and grep/find/ls) reads without a confirmation; writes never reach it.
   */
  folders: () => readonly string[];
  upsertMcp?: UpsertMcp;
  listMcp?: ListMcp;
}

/**
 * Marks file and shell operations as part of one tool invocation: pi's operations run only inside
 * `run`, and `guard` refuses an operation reached any other way.
 */
export interface ToolInvocation {
  run<T>(toolCallId: string, operation: () => T): T;
  /** Detached use is safe: file operations take it as a plain callback. */
  guard: () => string;
}

/**
 * Resolves the real path one file operation may touch, or throws to refuse it. The parent and
 * every subagent child build pi's file tools from the same operations and differ only here: the
 * parent confines to the data directory inside a tool invocation, a child decides through
 * `checkChildPath` (subagents/child-tools.ts).
 */
export type ResolvePath = (target: string) => Promise<string>;

/** Writes one file at an already resolved path; a child holds its sibling write lock around it. */
export type WriteResolved = (real: string, content: string) => Promise<void>;

const plainWrite: WriteResolved = (real, content) => writeFile(real, content);

/**
 * pi's read operations on confined paths. An image is detected by its content, so the read returns
 * it as image input (fitted to the model's limits) instead of its bytes as text.
 */
export function readOperations(readable: ResolvePath): ReadOperations {
  return {
    readFile: async (target) => readFile(await readable(target)),
    access: async (target) => {
      await stat(await readable(target));
    },
    detectImageMimeType: async (target) =>
      detectSupportedImageMimeTypeFromFile(await readable(target)),
  };
}

/** pi's edit operations: reads resolve as readable, the rewrite as writable. */
export function editOperations(
  readable: ResolvePath,
  writable: ResolvePath,
  write: WriteResolved = plainWrite,
): EditOperations {
  return {
    readFile: async (target) => readFile(await readable(target)),
    writeFile: async (target, content) => write(await writable(target), content),
    access: async (target) => {
      await stat(await readable(target));
    },
  };
}

/** Makes the folders pi's write creates first, at an already resolved path. */
export type MakeFolders = (real: string) => Promise<void>;

const plainFolders: MakeFolders = async (real) => {
  await mkdir(real, { recursive: true });
};

/** pi's write operations, including the parent directories it creates first. */
export function writeOperations(
  writable: ResolvePath,
  write: WriteResolved = plainWrite,
  makeFolders: MakeFolders = plainFolders,
): WriteOperations {
  return {
    writeFile: async (target, content) => write(await writable(target), content),
    mkdir: async (target) => makeFolders(await writable(target)),
  };
}

/**
 * Minimal service file/shell/command proxies. Pi owns the tool protocols;
 * the service owns confinement here, the shell policy in shell-tool.ts,
 * tier/grant checks, confirms and audit in the shared gate (harness/gate.ts),
 * and the confirm of every agent catalog write (atd-agents/catalog-writes.ts).
 * Desktop-only abilities arrive as capability requests, never as direct
 * filesystem or clipboard access.
 */
export function serviceTools(host: ServiceToolHost): ExtensionFactory {
  // The tool call each operation runs in; a bash call never leaves its approval to a write.
  const calls = new AsyncLocalStorage<WriteCall>();
  const current = (): WriteCall => {
    const call = calls.getStore();
    if (!call) throw new Error('A file operation requires a tool invocation.');
    return call;
  };
  const invocation: ToolInvocation = {
    run: (toolCallId, operation) =>
      calls.run({ toolCallId, signal: undefined, catalogWrite: false }, operation),
    guard: () => `${host.taskId}:${current().toolCallId}`,
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

  /** Whether a read targets a file of one of the task's own resources (`taskResources`). */
  async function readsTaskResource(args: unknown): Promise<boolean> {
    const target = pathOf(args);
    if (target === '') return false;
    const id = await resourceIdAt(host.taskResources.dir, host.cwd, target);
    return id !== null && host.taskResources.owns(id);
  }

  /** Roots only the read tool may reach beyond the data directory (service-fs.ts `confined`). */
  async function readRoots(): Promise<string[]> {
    return [...(await userAgentsReadRoots()), ...host.skillDirs(), ...host.folders()];
  }

  /**
   * Which of the run's own read-only material a read targets, if any: its skills, the task's
   * resources or a folder granted to the task. Reading it needs no confirmation; the read
   * operation still confines the path to the data dir and the read roots.
   */
  async function ownMaterial(args: unknown): Promise<'skill' | 'resource' | 'folder' | null> {
    if (await readsRunSkill(args)) return 'skill';
    if (await readsTaskResource(args)) return 'resource';
    const target = pathOf(args);
    const folders = host.folders();
    return target !== '' && (await inGrantedFolder(folders, host.dataDir, host.cwd, target, false))
      ? 'folder'
      : null;
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
        const own = name === 'read' ? await ownMaterial(args) : null;
        // A write that changes the subagent catalog is asked once, with its content, when written.
        let catalogWrite = false;
        let written: string | null = null;
        if (own) {
          const base = { taskId: host.taskId, runId: host.runId(), toolCallId: id };
          host.audit({ ...base, tool: `read:${own}`, decision: own });
        } else {
          // A path the operation would refuse fails before the gate, so no prompt or review
          // is spent on a call that cannot run.
          const target = resolveToolPath(host.cwd, pathOf(args));
          if (name === 'read') await confined(host.cwd, host.dataDir, target, await readRoots());
          else {
            written = (await confinedWrite(host.cwd, host.dataDir, target)).real;
            catalogWrite = (await catalogTarget(host.dataDir, written)) !== null;
          }
          if (!catalogWrite)
            await authorize({
              toolCallId: id,
              scope,
              title: titleOf(name, args),
              detail: detailOf(name, args),
              signal: signal ?? undefined,
            });
        }
        // Pi's tool context goes through untouched. It defines `tools` and `executeTool` as
        // non-enumerable properties, which a spread drops, and its `cwd` already is `host.cwd`:
        // pi-session.ts builds the session and these tools from the same task output directory.
        // A wrapper that needs another cwd must derive from the context, as in
        // `Object.create(ctx, { cwd: { value } })`, never spread it.
        const call: WriteCall = { toolCallId: id, signal: signal ?? undefined, catalogWrite };
        const done = await calls.run(call, () => tool.execute(id, args, signal, onUpdate, ctx));
        // What an unattended run wrote is audited, so its folder automation skips its own output.
        if (written !== null && name !== 'read' && host.unattended()) {
          const base = { taskId: host.taskId, runId: host.runId(), toolCallId: id };
          await auditWrote(host.audit, { ...base, tool: name, path: written });
        }
        return done;
      },
    };
  }

  /** The confined real path of a file a tool reads, inside a tool invocation only. */
  const readable =
    (roots: () => Promise<readonly string[]>): ResolvePath =>
    async (target) => {
      guard();
      return (await confined(host.cwd, host.dataDir, target, await roots())).real;
    };
  const writable: ResolvePath = async (target) => {
    guard();
    return (await confinedWrite(host.cwd, host.dataDir, target)).real;
  };
  const noRoots = async () => [];
  // Writes that change the subagent catalog ask the user every time (atd-agents/catalog-writes.ts).
  const catalog = { cwd: host.cwd, dataDir: host.dataDir, gate: authorize, call: current };
  const confirmed = (tool: 'write' | 'edit') => catalogConfirmedWrite({ ...catalog, tool });
  const edits = editOperations(readable(noRoots), writable, confirmed('edit'));
  const writes = writeOperations(
    writable,
    confirmed('write'),
    catalogDeferredFolders(host.dataDir),
  );

  return (pi) => {
    pi.registerTool(
      controlled(
        createReadToolDefinition(host.cwd, { operations: readOperations(readable(readRoots)) }),
        'read',
      ),
    );
    pi.registerTool(controlled(createEditToolDefinition(host.cwd, { operations: edits }), 'edit'));
    pi.registerTool(
      controlled(createWriteToolDefinition(host.cwd, { operations: writes }), 'write'),
    );
    pi.registerTool(bashToolDefinition(host, authorize, invocation));
    pi.registerTool(commandToolDefinition(host.dataDir, authorize));
    registerDesktopTool(pi, host);
    registerMcpCatalogTools(pi, host);
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
