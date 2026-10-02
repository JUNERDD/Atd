import { createJiti } from 'jiti';
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { MEMORY_TOOLS } from '@ai/agent-contracts';
import type { Logger } from '../logging.js';
import { readMemoryPause, writeMemoryPause } from './pause.js';
import type { MemoryTarget } from './policy.js';

/**
 * Hermes handles exposed by the patched `pi-hermes-memory/src/desktop.ts`
 * entry (see patches/pi-hermes-memory@0.9.9.patch). The service consumes the
 * entry through jiti exactly like the desktop host; the patch itself is T0
 * frozen and never edited here.
 */
export interface HermesEntry {
  id: string;
  target: MemoryTarget;
  content: string;
}

export interface HermesScope {
  canRead: () => boolean;
  canLearn: () => boolean;
  policyVersion: () => number;
  notify: (message: string, kind: 'info' | 'warning' | 'error') => void;
  changed: () => void;
}

export interface HermesDesktop {
  extension: (scope: HermesScope) => ExtensionFactory;
  list: () => Promise<unknown>;
  update: (entry: HermesEntry, content: string) => Promise<unknown>;
  runWithPolicy: <T>(allowed: () => boolean, action: () => Promise<T>) => Promise<T>;
  close: () => void;
}

async function loadHermes(agentDir: string): Promise<HermesDesktop> {
  // The patch's desktop-host switch: with it, a failed or policy-aborted direct review/flush never
  // falls back to spawning an external `pi` (which would write memory outside this authority and
  // its write guard). The service process is that host, and this is the only place it loads
  // Hermes. The patch also runs Hermes's SQLite on the runtime's built-in `node:sqlite`, so no
  // native module ships with the service.
  process.env.AI_DESKTOP_AGENT = '1';
  // The transpile cache roughly halves the first load.
  // Entries are keyed by source hash, so the pnpm patch applied to Hermes is never served stale.
  const jiti = createJiti(import.meta.url, { moduleCache: true, fsCache: true });
  const module = await jiti.import<{
    createDesktopMemory: (root: string) => Promise<HermesDesktop>;
  }>('pi-hermes-memory/src/desktop.ts');
  return module.createDesktopMemory(agentDir);
}

/** The memory tools that change the store; `memory_search` only reads it. */
const MEMORY_WRITE_TOOLS = new Set(MEMORY_TOOLS.filter((name) => name !== 'memory_search'));

export interface MemoryAuthorityEvents {
  notify: (message: string, kind: 'info' | 'warning' | 'error') => void;
  changed: () => void;
}

/**
 * Service-level authority events: Hermes notices and store changes land in the service log. The
 * authority is a per-agentDir singleton, so the first caller's events serve every runner.
 */
export function logMemoryEvents(log: Logger): MemoryAuthorityEvents {
  return {
    notify: (message, kind) => {
      if (kind === 'error') log.error('Memory notice.', { message });
      else if (kind === 'warning') log.warn('Memory notice.', { message });
      else log.info('Memory notice.', { message });
    },
    changed: () => log.debug('Memory store changed.'),
  };
}

/**
 * Single service Memory authority (D7). The Hermes Store/DatabaseManager pair
 * is instantiated exactly once per agentDir; every runner proxy delegates to
 * this instance. There are no per-runner competing stores.
 */
export class MemoryAuthority {
  private policyVersion = 0;
  private closed = false;

  private constructor(
    readonly agentDir: string,
    private readonly hermes: HermesDesktop,
    private readonly events: MemoryAuthorityEvents,
    /** Starts from the persisted pause (memory/pause.ts); `setPaused` keeps the file in step. */
    private paused: boolean,
  ) {}

  private static readonly instances = new Map<string, Promise<MemoryAuthority>>();
  private static readonly watchers = new Map<string, Set<() => void>>();

  /**
   * Calls `listener` whenever a run changes the store of `agentDir`: a memory tool write or a
   * learner commit. Those writes skip the HTTP routes, whose own writes the server already
   * announces, so this is how clients hear about them. Answers the unsubscribe.
   */
  static onChanged(agentDir: string, listener: () => void): () => void {
    const listeners = MemoryAuthority.watchers.get(agentDir) ?? new Set();
    listeners.add(listener);
    MemoryAuthority.watchers.set(agentDir, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) MemoryAuthority.watchers.delete(agentDir);
    };
  }

  /**
   * Returns the singleton for one agentDir. Concurrent callers share the
   * in-flight load; a failed load is dropped so the next caller retries.
   */
  static authorityFor(agentDir: string, events: MemoryAuthorityEvents): Promise<MemoryAuthority> {
    const existing = MemoryAuthority.instances.get(agentDir);
    if (existing) return existing;
    const pending = Promise.all([loadHermes(agentDir), readMemoryPause(agentDir)]).then(
      ([hermes, paused]) => new MemoryAuthority(agentDir, hermes, events, paused),
      (error: unknown) => {
        MemoryAuthority.instances.delete(agentDir);
        throw error;
      },
    );
    MemoryAuthority.instances.set(agentDir, pending);
    return pending;
  }

  /** Test/CLI hook: drops the cached singleton without touching the store. */
  static forgetForTests(agentDir: string): void {
    MemoryAuthority.instances.delete(agentDir);
  }

  isPaused(): boolean {
    return this.paused;
  }

  currentPolicyVersion(): number {
    return this.policyVersion;
  }

  /**
   * Pauses learning; in-flight learners abort via the policy revision. The pause is persisted
   * first, so a failed write leaves both the file and this authority unchanged.
   */
  async setPaused(paused: boolean): Promise<number> {
    this.assertOpen();
    await writeMemoryPause(this.agentDir, paused);
    this.paused = paused;
    this.policyVersion += 1;
    return this.policyVersion;
  }

  canRead(runMemory: boolean): boolean {
    return runMemory;
  }

  canLearn(runMemory: boolean, executionId: string): boolean {
    return runMemory && !this.paused && executionId.startsWith('root:');
  }

  /**
   * Runner memory tools. The child scope can never learn, even when the root
   * scope allows it; command materials stay excluded by the patched host.
   */
  extensionFor(scope: {
    runMemory: boolean;
    executionId: string;
    taskId: string;
  }): ExtensionFactory {
    this.assertOpen();
    const child = !scope.executionId.startsWith('root:');
    const hermes = this.hermes.extension({
      canRead: () => this.canRead(scope.runMemory),
      canLearn: () => !child && this.canLearn(scope.runMemory, scope.executionId),
      policyVersion: () => this.policyVersion,
      notify: this.events.notify,
      changed: () => this.changed(),
    });
    return async (pi) => {
      await hermes(pi);
      // Hermes reports only learner commits; a tool write that went through counts as well.
      pi.on('tool_execution_end', (event) => {
        if (!event.isError && MEMORY_WRITE_TOOLS.has(event.toolName)) this.changed();
      });
    };
  }

  /**
   * Root learn/flush path: the runner hands its prompt/flush work to the
   * authority, which gates it on the live policy revision and the root JSONL.
   * Child executions are rejected before any Hermes call.
   */
  runRootOperation<T>(
    scope: { runMemory: boolean; executionId: string },
    action: () => Promise<T>,
  ): Promise<T> {
    this.assertOpen();
    if (!scope.executionId.startsWith('root:'))
      return Promise.reject(new Error('Child executions cannot trigger memory learning.'));
    const version = this.policyVersion;
    return this.hermes.runWithPolicy(
      () => scope.runMemory && !this.paused && this.policyVersion === version,
      action,
    );
  }

  async list(): Promise<HermesEntry[]> {
    this.assertOpen();
    const entries = (await this.hermes.list()) as HermesEntry[];
    return entries.filter(
      (entry) =>
        typeof entry?.id === 'string' &&
        (entry.target === 'memory' || entry.target === 'user' || entry.target === 'failure') &&
        typeof entry.content === 'string',
    );
  }

  /**
   * Replaces the live entry named by `identity` with `content`, or removes it when `content` is
   * blank. Clients name an entry only by id and target; Hermes needs its saved text to find it,
   * so that text comes from the store. A missing entry reports as changed, like Hermes' own check.
   */
  async update(identity: Pick<HermesEntry, 'id' | 'target'>, content: string): Promise<void> {
    this.assertOpen();
    const entry = (await this.list()).find(
      (current) => current.id === identity.id && current.target === identity.target,
    );
    if (!entry) throw new Error('This memory changed. Reload it before editing.');
    const result = (await this.hermes.update(entry, content)) as {
      success?: boolean;
      error?: string;
    };
    if (result && typeof result === 'object' && result.success === false)
      throw new Error(result.error ?? 'Memory could not be updated.');
    this.policyVersion += 1;
  }

  private changed(): void {
    this.events.changed();
    for (const listener of MemoryAuthority.watchers.get(this.agentDir) ?? []) listener();
  }

  /** Service-owned flush/close; runners never close the shared store. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    MemoryAuthority.instances.delete(this.agentDir);
    this.hermes.close();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('The memory authority is closed.');
  }
}
