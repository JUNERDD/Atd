import {
  errorMessage,
  type MemoryOrigin,
  type MemoryProposal,
  type MemoryUnit,
} from '@atd/agent-contracts';
import type { LearnerOp } from './engine-types.js';
import { newProposal, unitProposal, type ProposalFields } from './proposals.js';
import { unitOf, type UnitDraft } from './unit.js';
import { deriveName, slugifyName } from './unit-names.js';
import {
  checkContent,
  draftNew,
  draftPatch,
  normalizeBody,
  normalizeDescription,
  runRules,
  type DraftRules,
} from './unit-writes.js';

/**
 * What one learner commit writes (docs/plans/2026-10-04-skill-shaped-memory.md, learning):
 * `create` and `update` become unit writes (`source: 'learned'`, not reviewed, with the learner's
 * origin) unless Ask before saving is on; `remove`, `propose_core` and `propose_skill` always
 * become suggestions. Learners address enabled units only: a turned-off unit is invisible to them.
 * They replace only the bodies their review saw whole (`shown`): an update writes a whole body, so
 * one written without the current body would lose what it held, and only its description change
 * goes through. An op that cannot apply is skipped with its reason; the others still go through.
 * A suggestion about a unit carries the revision that unit has once the commit is written, so
 * accepting it after a later change answers 409 instead of overwriting the newer version.
 */
export interface LearnContext {
  /** Every unit, enabled or not (names stay unique across all of them). */
  units: readonly MemoryUnit[];
  /** The pending suggestions; a derived name avoids the names pending creates hold. */
  pending: readonly MemoryProposal[];
  /** The units whose whole body the review saw, by name. */
  shown: ReadonlySet<string>;
  origin: MemoryOrigin;
  askFirst: boolean;
  now: string;
}

/** A unit the commit writes: a new one, or a new version of an existing one. */
export interface PlannedWrite {
  kind: 'create' | 'update';
  draft: UnitDraft;
}

export interface LearnPlan {
  writes: PlannedWrite[];
  proposals: MemoryProposal[];
  skipped: string[];
}

export function planLearned(ops: readonly LearnerOp[], context: LearnContext): LearnPlan {
  const planner = new LearnPlanner(context);
  for (const op of ops) planner.add(op);
  return planner.finish();
}

function label(op: LearnerOp): string {
  const name = 'name' in op ? op.name : undefined;
  return name ? `${op.op} "${name}"` : op.op;
}

class LearnPlanner {
  private readonly plan: LearnPlan = { writes: [], proposals: [], skipped: [] };
  /**
   * The units as the ops planned so far leave them, so a later op sees an earlier create; a
   * planned unit carries the revision its write will give it (`unitOf`).
   */
  private readonly units: MemoryUnit[];
  /** Units whose body may be replaced: those the review saw and those this commit creates. */
  private readonly shown: Set<string>;
  /** Names that pending and queued create suggestions hold, which a derived name avoids. */
  private readonly reserved: Set<string>;
  private readonly rules: DraftRules;

  constructor(private readonly context: LearnContext) {
    this.units = [...context.units];
    this.shown = new Set(context.shown);
    this.reserved = new Set(
      context.pending.flatMap((item) => (item.kind === 'create' ? [item.name] : [])),
    );
    this.rules = runRules('learned', context.origin);
  }

  /** The plan, each suggestion about a unit stamped with that unit's revision after the commit. */
  finish(): LearnPlan {
    const revisions = new Map(this.units.map((unit) => [unit.id, unit.revision]));
    for (const proposal of this.plan.proposals)
      if (proposal.unitId !== null)
        proposal.revision = revisions.get(proposal.unitId) ?? proposal.revision;
    return this.plan;
  }

  add(op: LearnerOp): void {
    try {
      switch (op.op) {
        case 'create':
          return this.create(op);
        case 'update':
          return this.update(op);
        case 'remove':
          return this.propose('remove', this.enabled(op.name), op.reason);
        case 'propose_core': {
          const unit = this.enabled(op.name);
          if (unit.activation === 'core') throw new TypeError('it is already always on');
          return this.propose('core', unit, op.reason);
        }
        case 'propose_skill':
          return this.skill(op);
      }
    } catch (error) {
      this.plan.skipped.push(`${label(op)}: ${errorMessage(error)}`);
    }
  }

  /** The enabled unit called `name`, or its slug. */
  private enabled(name: string): MemoryUnit {
    const slug = slugifyName(name);
    const unit =
      this.units.find((item) => item.enabled && item.name === name) ??
      this.units.find((item) => item.enabled && item.name === slug);
    if (!unit) throw new TypeError(`no enabled memory is named "${name}"`);
    return unit;
  }

  private create(op: Extract<LearnerOp, { op: 'create' }>): void {
    const description = normalizeDescription(op.description);
    const body = normalizeBody(op.body);
    checkContent(description, body);
    const slug = op.name === undefined ? '' : slugifyName(op.name);
    const same = slug ? this.units.find((unit) => unit.enabled && unit.name === slug) : undefined;
    // Creating what an enabled unit of the same type already names is that unit's update.
    if (same && same.type === op.type)
      return this.update({ op: 'update', name: same.name, description, body });
    if (this.units.some((unit) => unit.enabled && unit.type === op.type && unit.body === body))
      throw new TypeError('it is already remembered');
    // A given name identifies the memory, so a suggestion under it replaces a pending one; a
    // derived name only labels it, so it avoids the names other suggestions hold.
    const taken = new Set([...this.units.map((unit) => unit.name), ...this.reserved]);
    const name = slug || deriveName(description, op.type, taken);
    const input = { name, description, type: op.type, category: op.category ?? null, body };
    const draft = draftNew(input, this.rules, this.units, this.context.now);
    if (this.context.askFirst) {
      this.reserved.add(draft.name);
      return this.queue({
        kind: 'create',
        unitId: null,
        name: draft.name,
        description,
        body,
        type: op.type,
        category: draft.category,
        revision: null,
        reason: '',
      });
    }
    this.plan.writes.push({ kind: 'create', draft });
    this.units.push(unitOf(draft));
    this.shown.add(draft.name);
  }

  private update(op: Extract<LearnerOp, { op: 'update' }>): void {
    const unit = this.enabled(op.name);
    const unseen = op.body !== undefined && !this.shown.has(unit.name);
    const patch = {
      ...(op.description === undefined ? {} : { description: op.description }),
      ...(op.body === undefined || unseen ? {} : { body: op.body }),
    };
    const { draft, changed } = draftPatch(unit, patch, this.rules, this.units, this.context.now);
    if (!changed)
      throw new TypeError(unseen ? 'its body was not shown to the review' : 'it changes nothing');
    if (this.context.askFirst)
      return this.queue({
        kind: 'update',
        unitId: unit.id,
        name: unit.name,
        description: draft.description,
        body: draft.body,
        type: unit.type,
        category: null,
        revision: unit.revision,
        reason: '',
      });
    // A unit this commit creates is written once, with every change planned for it.
    const planned = this.plan.writes.find((write) => write.draft.id === unit.id);
    if (planned) planned.draft = draft;
    else this.plan.writes.push({ kind: 'update', draft });
    this.units[this.units.indexOf(unit)] = unitOf(draft);
  }

  private propose(kind: 'remove' | 'core', unit: MemoryUnit, reason: string): void {
    this.plan.proposals.push(
      unitProposal(kind, unit, reason, this.context.origin, this.context.now),
    );
  }

  private skill(op: Extract<LearnerOp, { op: 'propose_skill' }>): void {
    const name = slugifyName(op.name);
    if (!name) throw new TypeError('a skill name needs ASCII letters or digits');
    const description = normalizeDescription(op.description);
    const body = normalizeBody(op.body);
    checkContent(description, body);
    this.queue({
      kind: 'skill',
      unitId: null,
      name,
      description,
      body,
      type: null,
      category: null,
      revision: null,
      reason: op.reason,
    });
  }

  private queue(fields: ProposalFields): void {
    this.plan.proposals.push(newProposal(fields, this.context.origin, this.context.now));
  }
}
