import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CredentialStore } from '@earendil-works/pi-ai';
import { startChildTranscript, type ChildTranscriptSource } from './child-transcript.js';
import { SUBAGENT_CHILD_SYSTEM_PROMPT } from './config.js';
import {
  hostForTask,
  parentByTask,
  recordChildSession,
  taskIdFromCwd,
  trackChildEnd,
  trackChildSession,
  tryTrackChildStart,
  untrackChildSession,
  type ChildRecord,
} from './registry.js';

/**
 * T5 managedSettings trigger. The patched child session honors
 * `launch.managedSettings`, but the foreground executor never sets it, so the
 * service installs a process-wide factory wrapper that pins it on every
 * launch: projectTrusted:false plus forced noContextFiles plus explicit
 * system/append prompts, plus the parent's credential store so the child's
 * own model runtime can authenticate. The wrapper also tracks per-parent
 * children for UI aggregation and per-task abort without touching siblings,
 * links each created child to its parent call (`app-child`) and follows its
 * transcript until it disposes.
 */

type ManagedSettings = {
  systemPrompt?: string;
  appendSystemPrompt?: string;
  credentials?: CredentialStore;
};

interface ChildLaunchLike {
  cwd: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  managedSettings?: ManagedSettings;
  runtime?: { parentSessionId?: string; agent?: string };
}

interface ChildSessionLike extends ChildTranscriptSource {
  abort(): Promise<void>;
  dispose(): Promise<void>;
  sessionFile?: string | undefined;
  sessionId: string;
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

/** Pins managedSettings on a launch, preserving the agent prompts. */
export function pinManagedSettings<T extends ChildLaunchLike>(
  launch: T,
  credentials?: CredentialStore,
): T {
  const systemPrompt = launch.systemPrompt ?? SUBAGENT_CHILD_SYSTEM_PROMPT;
  const managed: ManagedSettings = { systemPrompt };
  if (launch.appendSystemPrompt !== undefined)
    managed.appendSystemPrompt = launch.appendSystemPrompt;
  if (credentials) managed.credentials = credentials;
  return { ...launch, managedSettings: managed };
}

/**
 * Installs the wrapper once per process. Idempotent: repeats return the
 * original install count. Must run before the first parent prompt.
 */
export async function installManagedSettingsTrigger(): Promise<{ installed: boolean }> {
  if (installed) return { installed: true };
  const module = await loadChildSessionModule();
  const inner = module.childSessionFactory();
  const wrapper: ChildFactoryLike = {
    async create(launch: ChildLaunchLike): Promise<ChildSessionLike> {
      const taskId = taskIdFromCwd(launch.cwd);
      const parentSessionId = launch.runtime?.parentSessionId;
      const agent = launch.runtime?.agent ?? 'service.worker';
      let tracked: { parentSessionId: string; key: string; record: ChildRecord } | null = null;
      if (parentSessionId) {
        const admission = tryTrackChildStart({ parentSessionId, agent });
        if (!admission.ok) throw new Error(admission.reason);
        tracked = { parentSessionId, key: admission.record.key, record: admission.record };
      }
      try {
        const credentials = taskId ? hostForTask(taskId)?.credentials : undefined;
        const child = await inner.create(pinManagedSettings(launch, credentials));
        if (!tracked) return child;
        const { record } = tracked;
        let closeTranscript: () => void;
        try {
          closeTranscript = adoptChild(record, child);
        } catch (error) {
          untrackChildSession(child.sessionId);
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
            untrackChildSession(child.sessionId);
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
 * transcript's close. Fails closed without a session file: the `app-child` entry, the child
 * transcript endpoint and the parent's cards all resolve the child through it.
 */
function adoptChild(record: ChildRecord, child: ChildSessionLike): () => void {
  const sessionFile = child.sessionFile;
  if (!sessionFile) throw new Error('The subagent child has no session file; refusing to start.');
  const host = hostForTask(record.taskId);
  if (!host) throw new Error('The subagent parent task is gone; refusing to start.');
  recordChildSession(record, sessionFile);
  trackChildSession(child.sessionId, record);
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
