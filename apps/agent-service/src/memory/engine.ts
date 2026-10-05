import {
  MemoryOriginSchema,
  type MemoryEntry,
  type MemoryOrigin,
  type MemoryOkResponse,
  type MemoryProposalAcceptResponse,
  type MemorySaveRequest,
  type MemorySettingsRequest,
  type MemorySettingsResponse,
  type MemoryStateResponse,
  type MemoryTarget,
  type MemoryUnit,
  type MemoryUnitResponse,
} from '@atd/agent-contracts';
import { Value } from 'typebox/value';
import type { Logger } from '../logging.js';
import type {
  LearnerCommit,
  LearnerOp,
  MemoryHit,
  MemoryRunScope,
  MemoryRuntimeStore,
  MemoryUnitInput,
  MemoryUnitPatch,
} from './engine-types.js';
import { planLearned } from './learn-commit.js';
import { MemoryStore } from './memory-store.js';
import { USER_RULES } from './unit-writes.js';

export interface MemoryAuthorityEvents {
  notify: (message: string, kind: 'info' | 'warning' | 'error') => void;
  changed: () => void;
}

/**
 * Service-level authority events: store notices and run-made changes land in the service log. The
 * authority is a per-agentDir singleton, so the first caller's events serve every caller.
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
 * The single memory authority of one agent dir (docs/plans/2026-10-04-skill-shaped-memory.md):
 * the only writer of the skill-shaped units under `<agentDir>/memory/` (memory-store.ts). Settings
 * (the HTTP routes), the run tools, the learners and apps are its clients, and every read and
 * write runs through one queue, so none of them sees another half done. Every write that runs or
 * learners can see bumps the policy version, which learners compare at commit (the review flag is
 * Settings bookkeeping and does not); writes made off the routes (tools, learners) also reach
 * `onChanged` listeners, while the server announces route writes itself.
 */
export class MemoryAuthority implements MemoryRuntimeStore {
  private policyVersion = 0;
  private closed = false;
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    readonly agentDir: string,
    private readonly memory: MemoryStore,
    private readonly events: MemoryAuthorityEvents,
  ) {}

  private static readonly instances = new Map<string, Promise<MemoryAuthority>>();
  private static readonly watchers = new Map<string, Set<() => void>>();

  /**
   * Calls `listener` whenever a run changes the memory of `agentDir`: a tool write or a learner
   * commit. Those skip the HTTP routes, whose writes the server already announces, so this is how
   * clients hear about them. Answers the unsubscribe.
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
   * The authority of one agentDir. Concurrent callers share the in-flight load; a failed load is
   * dropped so the next caller retries.
   */
  static authorityFor(agentDir: string, events: MemoryAuthorityEvents): Promise<MemoryAuthority> {
    const existing = MemoryAuthority.instances.get(agentDir);
    if (existing) return existing;
    const warn = (message: string) => events.notify(message, 'warning');
    const pending = MemoryStore.open(agentDir, warn).then(
      (memory) => new MemoryAuthority(agentDir, memory, events),
      (error: unknown) => {
        MemoryAuthority.instances.delete(agentDir);
        throw error;
      },
    );
    MemoryAuthority.instances.set(agentDir, pending);
    return pending;
  }

  currentPolicyVersion(): number {
    return this.policyVersion;
  }

  canRead(scope: MemoryRunScope): boolean {
    return scope.runMemory;
  }

  canLearn(scope: MemoryRunScope): boolean {
    return this.learnRefusal(scope) === null;
  }

  /** Why `scope` may not change memory, or null when it may. */
  private learnRefusal(scope: MemoryRunScope): string | null {
    if (!scope.runMemory) return 'Memory is turned off for this message.';
    if (!scope.executionId.startsWith('root:'))
      return 'Subagents can read memory but cannot change it.';
    if (this.memory.settings.paused) return 'Learning is paused in Memory settings.';
    return null;
  }

  /** Every unit in Settings order, the pending suggestions, the problems and the settings. */
  state(): Promise<MemoryStateResponse> {
    return this.serially(async () => {
      const { units, problems } = await this.memory.read();
      return {
        units: [...units],
        proposals: [...this.memory.proposals],
        problems: [...problems, ...this.memory.problems],
        ...this.memory.settings,
        version: this.policyVersion,
      };
    });
  }

  /** Every unit, turned off or not, in Settings order (type, then name). */
  units(): Promise<MemoryUnit[]> {
    return this.serially(async () => [...(await this.memory.read()).units]);
  }

  enabledUnits(): Promise<MemoryUnit[]> {
    return this.serially(async () =>
      (await this.memory.read()).units.filter((unit) => unit.enabled),
    );
  }

  /** The enabled units as apps read them: the body is the content. */
  async list(): Promise<MemoryEntry[]> {
    return (await this.enabledUnits()).map((unit) => ({
      id: unit.id,
      target: unit.type,
      content: unit.body,
    }));
  }

  readByName(name: string): Promise<MemoryUnit | null> {
    return this.serially(async () => {
      const { units } = await this.memory.read();
      return units.find((unit) => unit.enabled && unit.name === name) ?? null;
    });
  }

  search(query: string, options: { type?: MemoryTarget; limit: number }): Promise<MemoryHit[]> {
    return this.serially(() => this.memory.search(query, options));
  }

  /** Changes the learning settings; a change bumps the version, so in-flight learners stop. */
  setSettings(change: MemorySettingsRequest): Promise<MemorySettingsResponse> {
    return this.serially(async () => {
      if (await this.memory.changeSettings(change)) this.wrote(false);
      return { ...this.memory.settings, version: this.policyVersion };
    });
  }

  /** A unit written in Settings; a missing name is derived, a taken one refused (409). */
  create(input: MemoryUnitInput): Promise<MemoryUnitResponse> {
    return this.serially(async () => {
      const unit = await this.memory.create(input, USER_RULES);
      return { unit, version: this.wrote(false) };
    });
  }

  /** Saves the fields a Settings edit changed; a stale revision or a missing unit is a 409. */
  save(request: MemorySaveRequest): Promise<MemoryUnitResponse> {
    return this.serially(async () => {
      const { unit, changed } = await this.memory.save(request, USER_RULES);
      return { unit, version: changed ? this.wrote(false) : this.policyVersion };
    });
  }

  /** Moves a unit to the memory trash. */
  delete(id: string): Promise<MemoryOkResponse> {
    return this.serially(async () => {
      await this.memory.trash(id);
      return { ok: true, version: this.wrote(false) };
    });
  }

  /** Turns a unit on or off for runs, learners, `@` and apps; allowed while learning is paused. */
  setEnabled(id: string, enabled: boolean): Promise<MemoryOkResponse> {
    return this.flag(id, { enabled });
  }

  /** Clears a learned unit's New badge. */
  markReviewed(id: string): Promise<MemoryOkResponse> {
    return this.flag(id, { reviewed: true });
  }

  private flag(id: string, change: { enabled: boolean } | { reviewed: true }) {
    return this.serially(async (): Promise<MemoryOkResponse> => {
      const visible = (await this.memory.flag(id, change)) && 'enabled' in change;
      return { ok: true, version: visible ? this.wrote(false) : this.policyVersion };
    });
  }

  /** Applies a suggestion; a skill suggestion answers the Personal skill it created. */
  acceptProposal(id: string): Promise<MemoryProposalAcceptResponse> {
    return this.serially(async () => {
      const skill = await this.memory.accept(id);
      return {
        ok: true,
        version: this.wrote(false),
        skill: skill === null ? null : { name: skill },
      };
    });
  }

  dismissProposal(id: string): Promise<MemoryOkResponse> {
    return this.serially(async () => {
      await this.memory.dismiss(id);
      return { ok: true, version: this.wrote(false) };
    });
  }

  addFromTool(input: MemoryUnitInput, scope: MemoryRunScope): Promise<MemoryUnit> {
    return this.toolWrite(scope, async () => {
      const unit = await this.memory.createFromTool(input, toolOrigin(scope, 'memory_add'));
      return { result: unit, changed: true };
    });
  }

  replaceFromTool(
    name: string,
    patch: MemoryUnitPatch,
    scope: MemoryRunScope,
  ): Promise<MemoryUnit> {
    return this.toolWrite(scope, async () => {
      const origin = toolOrigin(scope, 'memory_replace');
      const { unit, changed } = await this.memory.patchFromTool(name, patch, origin);
      return { result: unit, changed };
    });
  }

  removeFromTool(name: string, scope: MemoryRunScope): Promise<void> {
    return this.toolWrite(scope, async () => {
      await this.memory.trashEnabled(name);
      return { result: undefined, changed: true };
    });
  }

  /**
   * Applies or queues a learner's ops (learn-commit.ts) while `scope` may learn and the policy
   * version still equals `version`; otherwise every op is skipped and nothing is written. `shown`
   * names the units whose whole body the review saw: only those bodies may be replaced.
   */
  commitLearned(
    ops: readonly LearnerOp[],
    scope: MemoryRunScope,
    version: number,
    trigger: string,
    shown: ReadonlySet<string>,
  ): Promise<LearnerCommit> {
    return this.serially(async () => {
      const origin = { taskId: scope.taskId, runId: scope.runId, trigger };
      const refusal =
        this.learnRefusal(scope) ??
        (version === this.policyVersion ? null : 'Memory changed after the learner started.') ??
        (Value.Check(MemoryOriginSchema, origin) ? null : 'The learner origin is not valid.');
      if (refusal)
        return { applied: 0, proposed: 0, skipped: ops.map((op) => `${op.op}: ${refusal}`) };
      const { units } = await this.memory.read(true);
      const plan = planLearned(ops, {
        units,
        pending: this.memory.proposals,
        shown,
        origin,
        askFirst: this.memory.settings.askFirst,
        now: new Date().toISOString(),
      });
      try {
        return { ...(await this.memory.commit(plan)), skipped: plan.skipped };
      } finally {
        // Announced even when a write failed midway: the writes before it stay.
        if (plan.writes.length || plan.proposals.length) this.wrote(true);
      }
    });
  }

  /** Stops the authority; the next `authorityFor` loads a new one. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    MemoryAuthority.instances.delete(this.agentDir);
    this.memory.close();
  }

  /** One tool write: refused unless `scope` may learn; a change is announced to listeners. */
  private toolWrite<T>(
    scope: MemoryRunScope,
    write: () => Promise<{ result: T; changed: boolean }>,
  ): Promise<T> {
    return this.serially(async () => {
      const refusal = this.learnRefusal(scope);
      if (refusal) throw new Error(refusal);
      const { result, changed } = await write();
      if (changed) this.wrote(true);
      return result;
    });
  }

  /** Records a write: bumps the policy version and, for a write off the routes, tells listeners. */
  private wrote(offRoute: boolean): number {
    this.policyVersion += 1;
    if (offRoute) {
      this.events.changed();
      for (const listener of MemoryAuthority.watchers.get(this.agentDir) ?? []) listener();
    }
    return this.policyVersion;
  }

  /** Runs reads and writes one at a time; nothing queued here may wait on the queue itself. */
  private serially<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('The memory authority is closed.'));
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
  }
}

/** Where a tool write comes from: the run's task and run, and the tool. */
function toolOrigin(scope: MemoryRunScope, trigger: string): MemoryOrigin {
  return { taskId: scope.taskId, runId: scope.runId, trigger };
}
