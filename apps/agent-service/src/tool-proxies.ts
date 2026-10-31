import { AsyncLocalStorage } from 'node:async_hooks';
import { isUtf8 } from 'node:buffer';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  createWriteToolDefinition,
  type EditOperations,
  type ExtensionFactory,
  type SessionManager,
  type WriteOperations,
} from '@earendil-works/pi-coding-agent';
import type { PermissionTier } from '@atd/agent-contracts';
import {
  catalogConfirmedWrite,
  catalogDeferredFolders,
  type WriteCall,
} from './atd-agents/catalog-writes.js';
import type { CapabilityRegistry } from './capabilities.js';
import { commandToolDefinition } from './commands/tool.js';
import { registerMcpCatalogTools, type ListMcp, type UpsertMcp } from './configure-mcp-tool.js';
import { ConfirmStore } from './confirms.js';
import { registerDesktopTool } from './desktop-tool.js';
import { loaderReadTool, resourceHints } from './file-loader/read-tool.js';
import { fileToolGate } from './file-tool-gate.js';
import { createAtdEditToolDefinition } from './file-tools/edit-tool.js';
import { observedPath, viewedReplace } from './file-view/call.js';
import { FileViews } from './file-view/tools.js';
import type { Reviewer } from './harness/auto-review.js';
import { createGate } from './harness/gate.js';
import type { Logger } from './logging.js';
import type { ResourceStore, TaskResources } from './resources.js';
import { confined, confinedWrite, userAgentsReadRoots } from './service-fs.js';
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
  /** The resource store a bash call's cut output is kept in, as a task resource (shell-tool.ts). */
  resources: Pick<ResourceStore, 'save'>;
  /**
   * Realpaths of the folders the task was granted, as the current run started: read-only
   * material the read tool (and grep/find/ls) reads without a confirmation; writes never reach it.
   */
  folders: () => readonly string[];
  /** Whether write and edit may reach only the task output directory (computer/tool-set.ts). */
  writesInsideOnly?: () => boolean;
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
 * every subagent child build pi's file tools from the same operations (read from
 * file-loader/read-tool.ts) and differ only here: the parent confines to the data directory inside
 * a tool invocation, a child decides through `checkChildPath` (subagents/child-tools.ts).
 */
export type ResolvePath = (target: string) => Promise<string>;

/** Writes one file at an already resolved path. */
export type WriteResolved = (real: string, content: string) => Promise<void>;

/**
 * pi's edit operations: reads resolve as readable, the rewrite as writable. The write step
 * defaults to the checked, atomic one of the File View Ledger (file-view/call.ts), which notes the
 * version the edit read and refuses to write over a change made since. pi's write and edit run
 * each call whole inside its per-file `withFileMutationQueue`, which serializes the
 * read-modify-write against every other write and edit of the file, the subagents' included: they
 * load pi's tools from the same instance (pi's extension virtual modules). Edit changes only
 * UTF-8 text: pi decodes and rewrites the file as UTF-8, which would replace a file in another
 * encoding (or one `read` showed as converted text) with mojibake.
 */
export function editOperations(
  readable: ResolvePath,
  writable: ResolvePath,
  write: WriteResolved = viewedReplace,
): EditOperations {
  const seen = observedPath(readable);
  return {
    readFile: async (target) => {
      const real = await seen(target);
      const bytes = await readFile(real);
      if (!isUtf8(bytes))
        throw new Error(
          `${path.basename(real)} is not UTF-8 text; edit changes only UTF-8 text files. Write a new file instead.`,
        );
      return bytes;
    },
    writeFile: async (target, content) => write(await writable(target), content),
    access: async (target) => {
      await stat(await seen(target));
    },
  };
}

/** Makes the folders pi's write creates first, at an already resolved path. */
export type MakeFolders = (real: string) => Promise<void>;

const plainFolders: MakeFolders = async (real) => {
  await mkdir(real, { recursive: true });
};

/**
 * pi's write operations, including the parent directories it creates first. The write step
 * defaults to the File View Ledger's (file-view/call.ts): it refuses to overwrite a file the
 * session did not see as it is now, and replaces the file atomically.
 */
export function writeOperations(
  writable: ResolvePath,
  write: WriteResolved = viewedReplace,
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
 * tier/grant checks, confirms and audit in the shared gate (harness/gate.ts,
 * file-tool-gate.ts for the file tools), what each session has seen of each
 * file in the File View Ledger (file-view/), and the confirm of every agent
 * catalog write (atd-agents/catalog-writes.ts). Desktop-only abilities arrive
 * as capability requests, never as direct filesystem or clipboard access.
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
  const insideOnly = () => host.writesInsideOnly?.() ?? false;
  const views = new FileViews({
    taskId: host.taskId,
    role: 'parent',
    sessionId: () => host.sessions.getSessionId(),
  });

  /** Roots only the read tool may reach beyond the data directory (service-fs.ts `confined`). */
  async function readRoots(): Promise<string[]> {
    return [...(await userAgentsReadRoots()), ...host.skillDirs(), ...host.folders()];
  }
  const controlled = fileToolGate({ host, authorize, calls, views, readRoots, insideOnly });

  /** The confined real path of a file a tool reads, inside a tool invocation only. */
  const readable =
    (roots: () => Promise<readonly string[]>): ResolvePath =>
    async (target) => {
      guard();
      return (await confined(host.cwd, host.dataDir, target, await roots())).real;
    };
  const writable: ResolvePath = async (target) => {
    guard();
    return (await confinedWrite(host.cwd, host.dataDir, target, insideOnly())).real;
  };
  const noRoots = async () => [];
  // Writes that change the subagent catalog ask the user every time (atd-agents/catalog-writes.ts).
  const catalog = { cwd: host.cwd, dataDir: host.dataDir, gate: authorize, call: current };
  const confirmed = (tool: 'write' | 'edit') =>
    catalogConfirmedWrite({ ...catalog, tool, write: viewedReplace });
  const edits = editOperations(readable(noRoots), writable, confirmed('edit'));
  const writes = writeOperations(
    writable,
    confirmed('write'),
    catalogDeferredFolders(host.dataDir),
  );

  return (pi) => {
    views.register(pi);
    const reads = readable(readRoots);
    const hints = resourceHints(host.taskResources, host.cwd);
    const read = loaderReadTool(host.cwd, observedPath(reads), hints);
    pi.registerTool(controlled(views.read(read, host.cwd, reads), 'read'));
    const edit = createAtdEditToolDefinition(host.cwd, { operations: edits });
    pi.registerTool(controlled(views.edit(edit), 'edit'));
    const write = createWriteToolDefinition(host.cwd, { operations: writes });
    pi.registerTool(controlled(views.write(write), 'write'));
    pi.registerTool(bashToolDefinition(host, authorize, invocation));
    pi.registerTool(commandToolDefinition(host.dataDir, authorize));
    registerDesktopTool(pi, host);
    registerMcpCatalogTools(pi, host, authorize);
  };
}
