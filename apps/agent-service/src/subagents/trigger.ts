import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CompactionSettings, RetrySettings } from '@earendil-works/pi-coding-agent';
import { compactionSettings, type PolicyModel } from '../compaction/policy.js';
import { REQUEST_POLICY } from '../request-policy.js';
import { startChildTranscript, type ChildTranscriptSource } from './child-transcript.js';
import { SUBAGENT_CHILD_SYSTEM_PROMPT } from './config.js';
import { launchModelProblem, type LaunchModelFields } from './launch-model.js';
import {
  hostForTask,
  parentByTask,
  parentBySession,
  type ChildModelRuntime,
  recordChildSession,
  taskIdFromCwd,
  trackChildEnd,
  tryTrackChildStart,
  type ChildRecord,
} from './registry.js';

/**
 * T5 managed launch trigger. The foreground executor builds child launches
 * without the service's limits, so the service installs a process-wide
 * factory wrapper that pins them on every launch through pi-subagents' own
 * launch fields: an untrusted project, no context files, explicit
 * system/append prompts, and (through the patched `hostModelRuntime` seam) a
 * model runtime built like the parent's so the child authenticates and
 * resolves the parent's model to the same catalog definition. The child's
 * settings get the service compaction policy for its model, which carries the
 * parent's frozen window through that runtime, so a model compacts alike in
 * the parent and its children (compaction/policy.ts). The wrapper also admits
 * each child under the session file its launch opens before `create` starts
 * the child's bridge, which finds the child's identity by that file, and runs
 * the child only once its bridge bound that identity. Before `create`, it also
 * refuses an admitted child whose model or thinking is not the one its parent
 * registered (launch-model.ts). It tracks per-parent children for UI
 * aggregation and per-task abort without touching siblings, links each created
 * child to its parent call (`app-child`) and follows its transcript until it
 * disposes.
 */

/** The `ChildSessionLaunch` fields the trigger reads or pins. */
interface ChildLaunchLike extends LaunchModelFields {
  cwd: string;
  projectTrusted?: boolean;
  noContextFiles: boolean;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  hostModelRuntime?: ChildModelRuntime;
  runtime?: { parentSessionId?: string; agent?: string; fast?: boolean };
  /** pi-subagents' `ChildSessionStorage`; a tracked child must open a known session file. */
  storage: { kind: 'file'; sessionFile: string } | { kind: 'dir' | 'default' | 'memory' };
}

/**
 * Fails an admitted child before it exists when its launch carries another model, thinking level
 * or fast mode than its parent registered for its agent under its run.
 */
function assertRegisteredModel(launch: ChildLaunchLike, record: ChildRecord): void {
  const agents = parentBySession(record.parentSessionId)?.agents;
  const expected = agents?.launchModel(record.parentRunId, record.agent) ?? null;
  const problem = launchModelProblem(launch, expected);
  if (problem) throw new Error(problem);
}

interface ChildSessionLike extends ChildTranscriptSource {
  abort(): Promise<void>;
  dispose(): Promise<void>;
  model?: PolicyModel | undefined;
  settingsManager: {
    applyOverrides(overrides: {
      compaction: CompactionSettings;
      retry: RetrySettings;
      httpIdleTimeoutMs: number;
    }): void;
  };
}

interface ChildFactoryLike {
  create(launch: ChildLaunchLike): Promise<ChildSessionLike>;
  dispose(): Promise<void>;
}

interface ChildSessionModule {
  childSessionFactory(): ChildFactoryLike;
  setChildSessionFactory(factory: ChildFactoryLike | undefined): void;
}

let installed = false;
let installations = 0;
const liveByTask = new Map<string, Set<ChildSessionLike>>();

async function loadChildSessionModule(): Promise<ChildSessionModule> {
  const require = createRequire(import.meta.url);
  const roots: string[] = [];
  // The package exports map hides ./package.json, so resolve the main entry
  // (package root index.js) and take its directory as the package root.
  try {
    roots.push(path.dirname(require.resolve('pi-subagents')));
  } catch {
    roots.push(path.join(process.cwd(), 'node_modules', 'pi-subagents'));
  }
  let lastError: unknown = null;
  for (const root of roots) {
    try {
      const href = pathToFileURL(path.join(root, 'src', 'runs', 'shared', 'child-session.js')).href;
      return (await import(href)) as ChildSessionModule;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `pi-subagents child session module is unavailable: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

/**
 * Pins the service limits on a launch, keeping the agent's own prompts. An empty append prompt is
 * still an explicit source, so pi skips APPEND_SYSTEM.md discovery and appends nothing. The host
 * model runtime only applies to parent-bound launches (`parentProviderRegistry`).
 */
export function pinManagedLaunch<T extends ChildLaunchLike>(
  launch: T,
  modelRuntime?: ChildModelRuntime,
): T {
  return {
    ...launch,
    projectTrusted: false,
    noContextFiles: true,
    systemPrompt: launch.systemPrompt ?? SUBAGENT_CHILD_SYSTEM_PROMPT,
    appendSystemPrompt: launch.appendSystemPrompt ?? '',
    ...(modelRuntime ? { hostModelRuntime: modelRuntime } : {}),
  };
}

/**
 * Installs the wrapper once per process. Idempotent: repeats return the
 * original install count. Must run before the first parent prompt.
 */
export async function installManagedLaunchTrigger(): Promise<{ installed: boolean }> {
  if (installed) return { installed: true };
  const module = await loadChildSessionModule();
  const inner = module.childSessionFactory();
  const wrapper: ChildFactoryLike = {
    async create(launch: ChildLaunchLike): Promise<ChildSessionLike> {
      const taskId = taskIdFromCwd(launch.cwd);
      const parentSessionId = launch.runtime?.parentSessionId;
      let tracked: { parentSessionId: string; key: string; record: ChildRecord } | null = null;
      if (parentSessionId) {
        // The child's identity decides its approvals, its model check and its `app-child`
        // record. pi-subagents names the agent on every launch it builds, so a parent-bound
        // launch without one comes from a changed upstream contract; no identity is invented.
        const agent = launch.runtime?.agent;
        if (!agent) throw new Error('The subagent child names no agent; refusing to start.');
        // Admitted before `create`: pi starts the child's bridge inside it, at the child's
        // session_start, and the bridge finds its identity by this session file.
        if (launch.storage.kind !== 'file')
          throw new Error('The subagent child has no session file; refusing to start.');
        const { sessionFile } = launch.storage;
        const admission = tryTrackChildStart({ parentSessionId, agent, sessionFile });
        if (!admission.ok) throw new Error(admission.reason);
        tracked = { parentSessionId, key: admission.record.key, record: admission.record };
      }
      try {
        if (tracked) assertRegisteredModel(launch, tracked.record);
        const modelRuntime = taskId ? hostForTask(taskId)?.childRuntime : undefined;
        const child = await inner.create(pinManagedLaunch(launch, modelRuntime));
        // Before the child's first prompt: children read settings from the agent dir otherwise.
        child.settingsManager.applyOverrides({
          ...REQUEST_POLICY,
          ...compactionSettings(child.model),
        });
        if (!tracked) return child;
        const { record } = tracked;
        let closeTranscript: () => void;
        try {
          closeTranscript = adoptChild(record, child);
        } catch (error) {
          await child.dispose().catch(() => undefined);
          throw error;
        }
        const live = liveByTask.get(record.taskId) ?? new Set<ChildSessionLike>();
        live.add(child);
        liveByTask.set(record.taskId, live);
        const dispose = child.dispose.bind(child);
        child.dispose = async () => {
          try {
            await dispose();
          } finally {
            live.delete(child);
            trackChildEnd(record.parentSessionId, record.key);
            closeTranscript();
          }
        };
        return child;
      } catch (error) {
        if (tracked) trackChildEnd(tracked.parentSessionId, tracked.key);
        throw error;
      }
    },
    async dispose(): Promise<void> {
      await inner.dispose();
    },
  };
  module.setChildSessionFactory(wrapper);
  installed = true;
  installations += 1;
  void installations;
  void parentByTask;
  return { installed: true };
}

/**
 * Links a created child to its parent call and starts following its transcript; returns the
 * transcript's close. Fails closed unless the child's bridge bound its identity: pi only reports a
 * bridge that throws at session_start, and the child would run on pi's own tools, unconfined.
 */
function adoptChild(record: ChildRecord, child: ChildSessionLike): () => void {
  if (!record.bridged)
    throw new Error('The subagent child bridge did not start; refusing to run the child.');
  const host = hostForTask(record.taskId);
  if (!host) throw new Error('The subagent parent task is gone; refusing to start.');
  recordChildSession(record);
  return startChildTranscript(record, host, child);
}

/** Aborts only one task tree's live children; siblings keep running. */
export async function abortTaskChildren(taskId: string): Promise<{ aborted: number }> {
  const live = liveByTask.get(taskId);
  if (!live?.size) return { aborted: 0 };
  const children = [...live];
  await Promise.allSettled(children.map((child) => child.abort()));
  await Promise.allSettled(children.map((child) => child.dispose().catch(() => undefined)));
  liveByTask.delete(taskId);
  return { aborted: children.length };
}

/** Counts live wrapped children for one task (isolation proof). */
export function liveChildCount(taskId: string): number {
  return liveByTask.get(taskId)?.size ?? 0;
}

/** Whether the trigger is installed in this process. */
export function isTriggerInstalled(): boolean {
  return installed;
}
