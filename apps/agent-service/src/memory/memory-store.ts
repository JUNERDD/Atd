import path from 'node:path';
import {
  errorMessage,
  type MemoryOrigin,
  type MemoryProblem,
  type MemoryProposal,
  type MemorySaveRequest,
  type MemorySettingsRequest,
  type MemoryTarget,
  type MemoryUnit,
} from '@atd/agent-contracts';
import { ConflictError } from '../errors.js';
import type { LearnerOp, MemoryHit, MemoryUnitInput, MemoryUnitPatch } from './engine-types.js';
import { searchTerms, snippetFor } from './fts-query.js';
import { MemoryIndex, type IndexQuery } from './index-db.js';
import { planLearned, type CommitContext, type LearnPlan } from './learn-commit.js';
import {
  applyProposal,
  mergeProposals,
  readProposals,
  unitProposal,
  writeProposals,
} from './proposals.js';
import { readMemorySettings, writeMemorySettings, type MemorySettings } from './settings.js';
import { draftOf } from './unit.js';
import { memoryRoot, UnitStore, type StoreSnapshot } from './unit-store.js';
import { draftNew, draftPatch, runRules, type DraftRules } from './unit-writes.js';

const STALE = 'This memory changed. Reload it before editing.';
const GONE = 'This suggestion is no longer pending. Reload Memory settings.';
/** The most hits one search answers. */
const MAX_HITS = 50;

const now = () => new Date().toISOString();

/**
 * Everything one agent dir remembers: the unit files (unit-store.ts), their search index, the
 * pending suggestions and the learning settings, kept consistent with each other. It knows
 * nothing of runs, policy versions or listeners, which the authority adds (engine.ts), and is not
 * safe for concurrent use: the authority runs its calls one at a time.
 */
export class MemoryStore {
  /** The store generation the index last synced; the index catches up before a search. */
  private indexedGeneration = -1;

  private constructor(
    private readonly files: UnitStore,
    private readonly index: MemoryIndex,
    private current: MemorySettings,
    private pending: MemoryProposal[],
    /** Problems with the settings or suggestions file, found when the store opened. */
    private fileProblems: { settings: MemoryProblem | null; proposals: MemoryProblem | null },
    private readonly warn: (message: string) => void,
  ) {}

  /** Opens the memory of `agentDir`, readying its files and index. */
  static async open(agentDir: string, warn: (message: string) => void): Promise<MemoryStore> {
    const root = memoryRoot(agentDir);
    const files = new UnitStore(root);
    await files.prepare(warn);
    const [settings, proposals] = await Promise.all([
      readMemorySettings(root),
      readProposals(root),
    ]);
    for (const problem of [settings.problem, proposals.problem])
      if (problem) warn(`${problem.message} (${problem.path})`);
    const index = MemoryIndex.open(path.join(root, 'index.db'), warn);
    const problems = { settings: settings.problem, proposals: proposals.problem };
    return new MemoryStore(files, index, settings.settings, proposals.proposals, problems, warn);
  }

  get settings(): MemorySettings {
    return this.current;
  }

  get proposals(): readonly MemoryProposal[] {
    return this.pending;
  }

  /** The settings and suggestions files' problems, listed in Settings beside the unit files'. */
  get problems(): MemoryProblem[] {
    const { settings, proposals } = this.fileProblems;
    return [settings, proposals].filter((problem) => problem !== null);
  }

  /** The units and problems; `force` re-checks the files even within the rescan interval. */
  read(force = false): Promise<StoreSnapshot> {
    return this.files.read(force);
  }

  /** Saves changed settings; answers whether anything changed. */
  async changeSettings(change: MemorySettingsRequest): Promise<boolean> {
    const next: MemorySettings = {
      paused: change.paused ?? this.current.paused,
      askFirst: change.askFirst ?? this.current.askFirst,
    };
    if (next.paused === this.current.paused && next.askFirst === this.current.askFirst)
      return false;
    await writeMemorySettings(this.files.root, next);
    this.current = next;
    this.fileProblems = { ...this.fileProblems, settings: null };
    return true;
  }

  /** Full-text search over the enabled units, best first. */
  async search(
    query: string,
    options: { type?: MemoryTarget; limit: number },
  ): Promise<MemoryHit[]> {
    const snapshot = await this.files.read();
    const terms = searchTerms(query);
    if (!terms.length) return [];
    const limit = Number.isInteger(options.limit)
      ? Math.min(Math.max(options.limit, 1), MAX_HITS)
      : MAX_HITS;
    const ids = this.indexSearch(snapshot, { terms, type: options.type, limit });
    const units = new Map(snapshot.units.map((unit) => [unit.id, unit]));
    return ids.flatMap((id) => {
      const unit = units.get(id);
      return unit?.enabled ? [{ unit, snippet: snippetFor(unit, terms) }] : [];
    });
  }

  async create(input: MemoryUnitInput, rules: DraftRules): Promise<MemoryUnit> {
    const { units } = await this.files.read(true);
    return this.files.create(draftNew(input, rules, units, now()));
  }

  /** Applies a Settings edit made at `revision`; a stale revision or a missing unit is a 409. */
  async save(
    request: MemorySaveRequest,
    rules: DraftRules,
  ): Promise<{ unit: MemoryUnit; changed: boolean }> {
    const { id, revision, ...patch } = request;
    const { units } = await this.files.read(true);
    const unit = units.find((item) => item.id === id);
    if (!unit || unit.revision !== revision) throw new ConflictError(STALE);
    return this.patch(unit, patch, rules, units);
  }

  /**
   * A tool's new unit, written as the agent's from `origin`. Only the user grants always-on, so a
   * request for `core` saves the unit in the index and waits as a suggestion.
   */
  async createFromTool(input: MemoryUnitInput, origin: MemoryOrigin): Promise<MemoryUnit> {
    const unit = await this.create(input, runRules('agent', origin));
    if (input.activation === 'core') await this.suggestCore(unit, origin);
    return unit;
  }

  /**
   * A tool's change to the enabled unit called `name`, the only units runs can address. A request
   * for `core` waits as a suggestion, and a core unit stays core (`DraftRules.core`).
   */
  async patchFromTool(
    name: string,
    patch: MemoryUnitPatch,
    origin: MemoryOrigin,
  ): Promise<{ unit: MemoryUnit; changed: boolean }> {
    const { units } = await this.files.read(true);
    const rules = runRules('agent', origin);
    const { unit, changed } = await this.patch(enabledNamed(units, name), patch, rules, units);
    const suggested = patch.activation === 'core' && unit.activation !== 'core';
    if (suggested) await this.suggestCore(unit, origin);
    return { unit, changed: changed || suggested };
  }

  private async patch(
    unit: MemoryUnit,
    patch: MemoryUnitPatch,
    rules: DraftRules,
    units: readonly MemoryUnit[],
  ): Promise<{ unit: MemoryUnit; changed: boolean }> {
    const { draft, content, changed } = draftPatch(unit, patch, rules, units, now());
    if (!changed) return { unit, changed };
    return { unit: await this.files.overwrite(draft, content), changed };
  }

  /** Moves a unit to the trash; a missing one is a 409. */
  async trash(id: string): Promise<void> {
    await this.remove((await this.unitById(id)).id);
  }

  async trashEnabled(name: string): Promise<void> {
    const { units } = await this.files.read(true);
    await this.remove(enabledNamed(units, name).id);
  }

  /** Trashes a unit and drops the suggestions about it, which can no longer apply. */
  private async remove(id: string): Promise<void> {
    await this.files.trash(id);
    if (this.pending.some((item) => item.unitId === id))
      await this.keep(this.pending.filter((item) => item.unitId !== id));
  }

  /**
   * Sets a unit's switch or review flag; answers whether it changed. A missing unit is a 409. The
   * fields a suggestion acts on stay as they were, so the suggestions made against the old version
   * move to the new revision instead of turning stale.
   */
  async flag(id: string, change: { enabled: boolean } | { reviewed: true }): Promise<boolean> {
    const unit = await this.unitById(id);
    const draft = { ...draftOf(unit), ...change };
    if (draft.enabled === unit.enabled && draft.reviewed === unit.reviewed) return false;
    const { revision } = await this.files.overwrite(draft, false);
    const current = (item: MemoryProposal) => item.unitId === id && item.revision === unit.revision;
    if (this.pending.some(current))
      await this.keep(this.pending.map((item) => (current(item) ? { ...item, revision } : item)));
    return true;
  }

  /** Queues a suggestion to make `unit` always on, which a tool asked for; the user decides. */
  private async suggestCore(unit: MemoryUnit, origin: MemoryOrigin): Promise<void> {
    await this.keep(mergeProposals(this.pending, [unitProposal('core', unit, '', origin, now())]));
  }

  /** What `ops` would write among the current units and suggestions (learn-commit.ts). */
  async plan(ops: readonly LearnerOp[], context: CommitContext): Promise<LearnPlan> {
    const { units } = await this.files.read(true);
    const askFirst = this.current.askFirst;
    return planLearned(ops, { ...context, units, pending: this.pending, askFirst, now: now() });
  }

  /** Writes a learner or consolidation commit's units and queues its suggestions. */
  async commit(plan: LearnPlan): Promise<{ applied: number; proposed: number }> {
    for (const write of plan.writes) {
      if (write.kind === 'create') await this.files.create(write.draft);
      else await this.files.overwrite(write.draft, true);
    }
    if (plan.proposals.length) await this.keep(mergeProposals(this.pending, plan.proposals));
    return { applied: plan.writes.length, proposed: plan.proposals.length };
  }

  /**
   * Applies and drops one suggestion; answers the Personal skill a skill suggestion created. The
   * suggestion is dropped first, so a failed suggestions write cannot leave an applied suggestion
   * pending to be applied twice; when applying fails, nothing was written and it is put back.
   */
  async accept(id: string): Promise<string | null> {
    const proposal = this.pending.find((item) => item.id === id);
    if (!proposal) throw new ConflictError(GONE);
    const { units } = await this.files.read(true);
    const before = this.pending;
    // An accepted removal also settles the other suggestions about that unit.
    const gone = proposal.kind === 'remove' ? proposal.unitId : null;
    await this.keep(
      before.filter((item) => item !== proposal && (gone === null || item.unitId !== gone)),
    );
    try {
      return await applyProposal(proposal, units, this.files, now());
    } catch (error) {
      await this.keep(before).catch((restore: unknown) => {
        this.warn(`A refused suggestion could not be put back (${errorMessage(restore)}).`);
      });
      throw error;
    }
  }

  async dismiss(id: string): Promise<void> {
    if (!this.pending.some((item) => item.id === id)) throw new ConflictError(GONE);
    await this.keep(this.pending.filter((item) => item.id !== id));
  }

  close(): void {
    this.index.close();
  }

  private async keep(proposals: MemoryProposal[]): Promise<void> {
    await writeProposals(this.files.root, proposals);
    this.pending = proposals;
  }

  private async unitById(id: string): Promise<MemoryUnit> {
    const unit = (await this.files.read(true)).units.find((item) => item.id === id);
    if (!unit) throw new ConflictError(STALE);
    return unit;
  }

  /** Searches the index, rebuilding it once when it fails. */
  private indexSearch(snapshot: StoreSnapshot, query: IndexQuery): string[] {
    try {
      return this.syncedIndex(snapshot).search(query);
    } catch (error) {
      this.warn(`The memory index failed and was rebuilt (${errorMessage(error)}).`);
      this.index.reset();
      this.indexedGeneration = -1;
      return this.syncedIndex(snapshot).search(query);
    }
  }

  private syncedIndex(snapshot: StoreSnapshot): MemoryIndex {
    if (snapshot.generation !== this.indexedGeneration) {
      this.index.sync(snapshot.units);
      this.indexedGeneration = snapshot.generation;
    }
    return this.index;
  }
}

/** The enabled unit called `name`; turned-off units are out of the runs' reach. */
function enabledNamed(units: readonly MemoryUnit[], name: string): MemoryUnit {
  const unit = units.find((item) => item.enabled && item.name === name);
  if (!unit) throw new Error(`No enabled memory is named "${name}".`);
  return unit;
}
