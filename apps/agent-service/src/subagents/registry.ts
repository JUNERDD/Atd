import path from 'node:path';
import {
  childExecutionId,
  subagentChildKey,
  type ChildTranscriptPatchData,
  type SubagentChildEntry,
} from '@ai/agent-contracts';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { PermissionLookups } from '../transcript-blocks.js';
import type { ChildApprovals, ChildApprovalsRequest } from './approvals.js';

/**
 * T5 in-process parent/child registry. Foreground children share the parent
 * process, but Pi loads the required bridge through its own loader, so state
 * lives on `globalThis` under a versioned symbol: both loader instances meet
 * here. Background/detached paths are closed and never registered.
 */

export interface ParentRecord {
  taskId: string;
  runId: string;
  sessionId: string;
  tools: string[];
  roleId: string;
  /**
   * Runtime agents this parent session registered and may delegate to: the
   * service agents plus the atd agents its runs referenced. Fixed for the
   * session's life; the run binding key rebuilds the session when it changes.
   */
  agents: string[];
  stopping: boolean;
  /**
   * The launching `subagent` call the guard admitted and whose result has not landed. Children
   * launched meanwhile belong to it; the service admits one launching call at a time, so a single
   * value cannot be overwritten by a concurrent call.
   */
  activeToolCallId: string | null;
  /** Launch order within `activeToolCallId`; reset when the guard admits a call. */
  launchSeq: number;
  /** Appends an `app-child` entry to the parent session (its live SessionManager). */
  appendChildEntry: (entry: SubagentChildEntry) => void;
}

export interface ChildRecord {
  /** `subagentChildKey(toolCallId, seq)`: the child transcript key. */
  key: string;
  parentSessionId: string;
  taskId: string;
  parentRunId: string;
  /** Process-wide launch number inside `executionId`. */
  index: number;
  /** The parent `subagent` call that launched this child. */
  toolCallId: string;
  /** Launch order within `toolCallId`. */
  seq: number;
  agent: string;
  executionId: string;
  startedAt: string;
  /** The child's session JSONL; set once the child session exists. */
  sessionFile: string | null;
}

/** Builds one child's model runtime on the parent's credentials, endpoint and model catalog. */
export type ChildModelRuntime = () => Promise<ModelRuntime>;

/** Host handles the child bridge needs; stored per task, never serialized. */
export interface SubagentHost {
  dataDir: string;
  cwd: string;
  allowedTools: string[];
  mcpProxies: string[];
  runMemory: boolean;
  /** Parent run audit sink; child entries land in the same run file. */
  audit: (entry: Record<string, unknown>) => void;
  /** Child memory factory from the service singleton (search, no learn). */
  memoryFactory?: (pi: unknown) => void;
  /** Builds per-child MCP proxies bound to one child execution id. */
  mcpBuilder?: (executionId: string) => (pi: unknown) => void;
  /** Ledger resource ids frozen for this run (resource-ref checks). */
  resourceIds: string[];
  /** Builds each child's model runtime like the parent's (run-model.ts `childRuntime`). */
  childRuntime: ChildModelRuntime;
  /** Approvals for one child execution; child bash and command saves decide through them. */
  approvals: (child: ChildApprovalsRequest) => ChildApprovals;
  /** Publishes one child's transcript patch as an event of the parent task. */
  publishChildTranscript: (
    child: { runId: string; executionId: string },
    data: ChildTranscriptPatchData,
  ) => void;
  /** Permission outcomes recorded in the parent session; child approvals land there. */
  parentPermissions: () => PermissionLookups;
}

interface RegistryStore {
  parentsBySession: Map<string, ParentRecord>;
  parentsByTask: Map<string, ParentRecord>;
  childrenByParent: Map<string, Map<string, ChildRecord>>;
  activeWrites: Map<string, Map<string, string>>;
  hosts: Map<string, SubagentHost>;
  childSessions: Map<string, ChildRecord>;
  childSequence: number;
}

const STORE_KEY = Symbol.for('ai.agent-service.subagents.v1');

function store(): RegistryStore {
  const global = globalThis as Record<symbol, RegistryStore | undefined>;
  const existing = global[STORE_KEY];
  if (existing) return existing;
  const created: RegistryStore = {
    parentsBySession: new Map(),
    parentsByTask: new Map(),
    childrenByParent: new Map(),
    activeWrites: new Map(),
    hosts: new Map(),
    childSessions: new Map(),
    childSequence: 0,
  };
  global[STORE_KEY] = created;
  return created;
}

/** Registers a parent session; replaces any stale record for the task. */
export function registerParent(
  record: Omit<ParentRecord, 'stopping' | 'activeToolCallId' | 'launchSeq'>,
): void {
  const state = store();
  const full: ParentRecord = { ...record, stopping: false, activeToolCallId: null, launchSeq: 0 };
  const stale = state.parentsByTask.get(record.taskId);
  if (stale && stale.sessionId !== record.sessionId) state.parentsBySession.delete(stale.sessionId);
  state.parentsBySession.set(record.sessionId, full);
  state.parentsByTask.set(record.taskId, full);
}

/** Stores the child-visible host record for one task (identity + ceiling). */
export function storeHost(taskId: string, host: SubagentHost): void {
  store().hosts.set(taskId, host);
}

/** Reads the host record the bridge uses to build child proxies. */
export function hostForTask(taskId: string): SubagentHost | null {
  return store().hosts.get(taskId) ?? null;
}

/** Points the child host at the ledger resources the task's current run attached. */
export function rebindHostResources(taskId: string, resourceIds: string[]): void {
  const host = store().hosts.get(taskId);
  if (host) store().hosts.set(taskId, { ...host, resourceIds: [...resourceIds] });
}

/** Rebinds a live parent session to its newest run. */
export function rebindParentRun(taskId: string, runId: string, tools: string[]): void {
  const record = store().parentsByTask.get(taskId);
  if (!record) return;
  record.runId = runId;
  record.tools = [...tools];
  record.stopping = false;
  record.activeToolCallId = null;
}

/** Removes a parent and drops its tracked children and write locks. */
export function unregisterParentBySession(sessionId: string): void {
  const state = store();
  const record = state.parentsBySession.get(sessionId);
  if (!record) return;
  state.parentsBySession.delete(sessionId);
  if (state.parentsByTask.get(record.taskId)?.sessionId === sessionId)
    state.parentsByTask.delete(record.taskId);
  state.childrenByParent.delete(sessionId);
  state.activeWrites.delete(record.taskId);
}

export function parentBySession(sessionId: string): ParentRecord | null {
  return store().parentsBySession.get(sessionId) ?? null;
}

export function parentByTask(taskId: string): ParentRecord | null {
  return store().parentsByTask.get(taskId) ?? null;
}

/** Derives the taskId from a service output cwd (`tasks/<id>/output`). */
export function taskIdFromCwd(cwd: string): string | null {
  const parts = path.resolve(cwd).split(path.sep);
  const at = parts.lastIndexOf('tasks');
  const id = at === -1 ? undefined : parts[at + 1];
  return id && /^[a-zA-Z0-9_-]+$/.test(id) ? id : null;
}

/** Parent lookup for a child launch, by cwd-derived taskId. */
export function parentForChildCwd(cwd: string): ParentRecord | null {
  const taskId = taskIdFromCwd(cwd);
  return taskId ? parentByTask(taskId) : null;
}

/** Marks the launching call the guard admitted; its children launch until its result lands. */
export function beginDelegation(taskId: string, toolCallId: string): void {
  const record = store().parentsByTask.get(taskId);
  if (!record) return;
  record.activeToolCallId = toolCallId;
  record.launchSeq = 0;
}

/** Ends the admitted call; a different call's end leaves it active. */
export function endDelegation(taskId: string, toolCallId: string): void {
  const record = store().parentsByTask.get(taskId);
  if (record?.activeToolCallId === toolCallId) record.activeToolCallId = null;
}

/**
 * Tracks a child launch; refuses unknown or stopping parents and launches no admitted call owns
 * (fail closed: a child without its call could not be linked to a transcript row). Never by count.
 */
export function tryTrackChildStart(input: {
  parentSessionId: string;
  agent: string;
}): { ok: true; record: ChildRecord } | { ok: false; reason: string } {
  const state = store();
  const parent = state.parentsBySession.get(input.parentSessionId);
  if (!parent) return { ok: false, reason: 'Unknown parent session.' };
  if (parent.stopping) return { ok: false, reason: 'The parent is stopping; no new children.' };
  const toolCallId = parent.activeToolCallId;
  if (!toolCallId) return { ok: false, reason: 'No admitted subagent call owns this launch.' };
  const live = state.childrenByParent.get(input.parentSessionId) ?? new Map<string, ChildRecord>();
  const index = state.childSequence;
  state.childSequence += 1;
  const seq = parent.launchSeq;
  parent.launchSeq += 1;
  const record: ChildRecord = {
    key: subagentChildKey(toolCallId, seq),
    parentSessionId: input.parentSessionId,
    taskId: parent.taskId,
    parentRunId: parent.runId,
    index,
    toolCallId,
    seq,
    agent: input.agent,
    executionId: childExecutionId(parent.runId, index),
    startedAt: new Date().toISOString(),
    sessionFile: null,
  };
  live.set(record.key, record);
  state.childrenByParent.set(input.parentSessionId, live);
  return { ok: true, record };
}

/**
 * Records a created child: its session file and the parent's `app-child` entry, the only link from
 * the parent call to the child session. Throws when the parent session is gone.
 */
export function recordChildSession(record: ChildRecord, sessionFile: string): void {
  const parent = store().parentsBySession.get(record.parentSessionId);
  if (!parent) throw new Error('The parent session ended before the child started.');
  record.sessionFile = sessionFile;
  parent.appendChildEntry({
    toolCallId: record.toolCallId,
    seq: record.seq,
    executionId: record.executionId,
    agent: record.agent,
    sessionFile,
    startedAt: record.startedAt,
  });
}

/** Releases a tracked child; unknown keys are ignored. */
export function trackChildEnd(parentSessionId: string, key: string): void {
  store().childrenByParent.get(parentSessionId)?.delete(key);
}

/** Lists live children for one parent (UI aggregation + cancel). */
export function liveChildren(parentSessionId: string): ChildRecord[] {
  return [...(store().childrenByParent.get(parentSessionId)?.values() ?? [])];
}

/** Marks a parent stopping so the guard admits no new launches. */
export function markParentStopping(taskId: string): void {
  const record = store().parentsByTask.get(taskId);
  if (!record) return;
  record.stopping = true;
  record.activeToolCallId = null;
}

/** True while a parent refuses new subagent launches. */
export function isParentStopping(taskId: string): boolean {
  return store().parentsByTask.get(taskId)?.stopping ?? false;
}

/** Guards parallel same-file writes across sibling foreground children. */
export function tryAcquireWrite(
  taskId: string,
  realPath: string,
  executionId: string,
): { ok: true } | { ok: false; owner: string } {
  const state = store();
  const held = state.activeWrites.get(taskId) ?? new Map<string, string>();
  const owner = held.get(realPath);
  if (owner && owner !== executionId) return { ok: false, owner };
  held.set(realPath, executionId);
  state.activeWrites.set(taskId, held);
  return { ok: true };
}

/** Releases a write lock held by one child execution. */
export function releaseWrite(taskId: string, realPath: string, executionId: string): void {
  const held = store().activeWrites.get(taskId);
  if (held?.get(realPath) === executionId) held.delete(realPath);
}

/** Drops all registry state for one task tree (isolated cleanup). */
export function forgetTaskTree(taskId: string): void {
  const state = store();
  const record = state.parentsByTask.get(taskId);
  if (record) {
    record.activeToolCallId = null;
    state.parentsBySession.delete(record.sessionId);
    state.childrenByParent.delete(record.sessionId);
    state.parentsByTask.delete(taskId);
  }
  state.activeWrites.delete(taskId);
  state.hosts.delete(taskId);
  for (const [sessionId, child] of state.childSessions) {
    if (child.taskId === taskId) state.childSessions.delete(sessionId);
  }
}

/** Maps a live child session id to its tracked record (bridge lookup). */
export function trackChildSession(sessionId: string, record: ChildRecord): void {
  store().childSessions.set(sessionId, record);
}

/** Resolves a child session id to its parent run and execution id. */
export function childBySession(sessionId: string): ChildRecord | null {
  return store().childSessions.get(sessionId) ?? null;
}

/** Drops a child session mapping when the child disposes. */
export function untrackChildSession(sessionId: string): void {
  store().childSessions.delete(sessionId);
}
