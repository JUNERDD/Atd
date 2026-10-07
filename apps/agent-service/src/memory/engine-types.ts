import type {
  MemoryActivation,
  MemoryCategory,
  MemoryTarget,
  MemoryUnit,
} from '@atd/agent-contracts';

/**
 * The internal contract of the skill-shaped memory engine (docs/plans/2026-10-04-skill-shaped-memory.md):
 * the memory authority implements `MemoryRuntimeStore`; the run integration (freeze, prompt
 * sections, tools) and the learners use only this surface, so each side builds and tests against
 * it on its own.
 */

/** The scope a run's memory work runs under: its frozen memory flag and its execution. */
export interface MemoryRunScope {
  /** The run snapshot's `memory` flag. */
  runMemory: boolean;
  /** `root:<runId>` for the parent session (rootExecutionId); anything else is a child. */
  executionId: string;
  taskId: string;
  runId: string;
}

/** A new unit, from Settings, a tool or a learner. A missing name is derived and made unique. */
export interface MemoryUnitInput {
  name?: string;
  description: string;
  type: MemoryTarget;
  category?: MemoryCategory | null;
  activation?: MemoryActivation;
  body: string;
}

/** The fields a write changes; absent fields keep their value. */
export interface MemoryUnitPatch {
  name?: string;
  description?: string;
  type?: MemoryTarget;
  category?: MemoryCategory | null;
  activation?: MemoryActivation;
  body?: string;
}

/** One `memory_search` hit: an enabled unit and the matched passage of its text. */
export interface MemoryHit {
  unit: MemoryUnit;
  snippet: string;
}

/**
 * What a learner asks for, addressing existing units by name. `create` and `update` apply
 * directly unless Ask before saving is on; `remove`, `propose_core` and `propose_skill` always
 * wait in proposals for the user.
 */
export type LearnerOp =
  | {
      op: 'create';
      name?: string;
      description: string;
      type: MemoryTarget;
      category?: MemoryCategory | null;
      body: string;
    }
  | { op: 'update'; name: string; description?: string; body?: string }
  | { op: 'remove'; name: string; reason: string }
  | { op: 'propose_core'; name: string; reason: string }
  | { op: 'propose_skill'; name: string; description: string; body: string; reason: string };

/** How a learner commit ended: units written, proposals queued, ops skipped (with reasons). */
export interface LearnerCommit {
  applied: number;
  proposed: number;
  skipped: string[];
}

/**
 * How a consolidation commit ended: refused because learning is paused or memory changed since the
 * consolidation read it (nothing written), or the learner-style counts and the enabled units the
 * commit left, which the next consolidation compares against.
 */
export type ConsolidationCommit =
  | { refused: 'paused' | 'changed' }
  | (LearnerCommit & { refused: null; units: MemoryUnit[] });

/** The engine surface runs and learners use; implemented by the memory authority. */
export interface MemoryRuntimeStore {
  /** Reading is allowed when the run enables memory, for root and child executions alike. */
  canRead(scope: MemoryRunScope): boolean;
  /** Learning needs the run's memory flag, learning not paused, and a root execution. */
  canLearn(scope: MemoryRunScope): boolean;
  /**
   * Bumped by every policy change and every write runs or learners can see; learners compare it
   * at commit.
   */
  currentPolicyVersion(): number;
  /**
   * Enabled units in a stable order (type `user`, `memory`, `failure`, then name), the input of a
   * run's freeze and of the learners' view of what is already remembered.
   */
  enabledUnits(): Promise<MemoryUnit[]>;
  /** Full-text search over enabled units; terms under three characters still match. */
  search(query: string, options: { type?: MemoryTarget; limit: number }): Promise<MemoryHit[]>;
  /** An enabled unit by name, or null when none is enabled under that name. */
  readByName(name: string): Promise<MemoryUnit | null>;
  /**
   * Tool writes (`source: 'agent'`); each checks `canLearn(scope)` and throws when refused. Only
   * the user grants always-on: a request for `core` waits as a suggestion, and a core unit keeps
   * its activation.
   */
  addFromTool(input: MemoryUnitInput, scope: MemoryRunScope): Promise<MemoryUnit>;
  replaceFromTool(name: string, patch: MemoryUnitPatch, scope: MemoryRunScope): Promise<MemoryUnit>;
  removeFromTool(name: string, scope: MemoryRunScope): Promise<void>;
  /**
   * Applies or queues a learner's ops (`source: 'learned'`, `reviewed: false`, origin from the
   * scope and `trigger`) only while `canLearn(scope)` holds and the policy version still equals
   * `version`, captured when the learner started; otherwise nothing is written. `shown` names the
   * units whose whole body the review saw; no other unit's body is replaced.
   */
  commitLearned(
    ops: readonly LearnerOp[],
    scope: MemoryRunScope,
    version: number,
    trigger: string,
    shown: ReadonlySet<string>,
  ): Promise<LearnerCommit>;
}
