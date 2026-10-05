import { randomUUID } from 'node:crypto';
import { readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import {
  MemoryProposalSchema,
  type MemoryOrigin,
  type MemoryProblem,
  type MemoryProposal,
  type MemoryUnit,
} from '@atd/agent-contracts';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { atomicWrite } from '../config.js';
import { ConflictError } from '../errors.js';
import { createAtdSkill } from '../skills/atd-skills.js';
import { coreFits } from './run-memory.js';
import { CORE_BUDGET } from './unit.js';
import type { UnitStore } from './unit-store.js';
import { draftNew, draftPatch, runRules } from './unit-writes.js';

/**
 * Suggestions waiting for the user, `<memory root>/proposals.json`: removals, promotions to
 * always-on (from learners, and from tools asking for it), Personal skills from learned procedures,
 * and (with Ask before saving on) every learner create and update. Nothing here reaches runs until
 * the user accepts it.
 */
const ProposalsFileSchema = Type.Object(
  { version: Type.Literal(1), proposals: Type.Array(MemoryProposalSchema) },
  { additionalProperties: false },
);

/** Pending suggestions kept; the oldest go first once a learner adds more. */
export const MAX_PROPOSALS = 100;

/** A suggestion's own fields: everything but its id, time and origin. */
export type ProposalFields = Omit<MemoryProposal, 'id' | 'created' | 'origin'>;

function proposalsFile(root: string): string {
  return path.join(root, 'proposals.json');
}

/**
 * The pending suggestions, oldest first; a missing file has none. A file that does not hold valid
 * suggestions is moved aside, so memory still opens: the suggestions start empty and the problem
 * names where the file went.
 */
export async function readProposals(
  root: string,
): Promise<{ proposals: MemoryProposal[]; problem: MemoryProblem | null }> {
  const file = proposalsFile(root);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { proposals: [], problem: null };
    parsed = undefined;
  }
  if (Value.Check(ProposalsFileSchema, parsed))
    return { proposals: parsed.proposals, problem: null };
  const aside = `${file}.invalid-${Date.now()}`;
  await rename(file, aside);
  return {
    proposals: [],
    problem: {
      path: aside,
      message: 'Memory suggestions could not be read, so they start empty. The file was kept here.',
    },
  };
}

export async function writeProposals(
  root: string,
  proposals: readonly MemoryProposal[],
): Promise<void> {
  await atomicWrite(proposalsFile(root), { version: 1, proposals });
}

/**
 * A new suggestion from `origin`, its reason on one line; throws a TypeError when it breaks the
 * suggestion limits.
 */
export function newProposal(
  fields: ProposalFields,
  origin: MemoryOrigin,
  now: string,
): MemoryProposal {
  const proposal: MemoryProposal = {
    id: randomUUID(),
    ...fields,
    reason: fields.reason.replace(/\s+/g, ' ').trim().slice(0, 1000),
    created: now,
    origin,
  };
  if (!Value.Check(MemoryProposalSchema, proposal))
    throw new TypeError('the suggestion does not fit the suggestion limits');
  return proposal;
}

/** A suggestion to remove `unit` or make it always on, made against its current revision. */
export function unitProposal(
  kind: 'remove' | 'core',
  unit: MemoryUnit,
  reason: string,
  origin: MemoryOrigin,
  now: string,
): MemoryProposal {
  const { id, name, description, type, revision } = unit;
  const fields = { kind, unitId: id, name, description, body: '', type, category: null, revision };
  return newProposal({ ...fields, reason }, origin, now);
}

/**
 * `added` after `existing`. A newer suggestion replaces a pending one of the same kind for the
 * same unit (or, without a unit, the same name) and moves to the end, so a learner repeating
 * itself leaves one row.
 */
export function mergeProposals(
  existing: readonly MemoryProposal[],
  added: readonly MemoryProposal[],
): MemoryProposal[] {
  const merged = new Map<string, MemoryProposal>();
  for (const proposal of [...existing, ...added]) {
    const key = `${proposal.kind}:${proposal.unitId ?? proposal.name}`;
    merged.delete(key);
    merged.set(key, proposal);
  }
  return [...merged.values()].slice(-MAX_PROPOSALS);
}

/**
 * Applies one suggestion the user accepted, among the current `units`. A create or update is
 * written as learned but reviewed (the user just accepted it); a skill becomes the Personal skill
 * `~/.atd/skills/<name>/SKILL.md`, whose name this answers. A suggestion that no longer applies,
 * because its unit is gone or changed since it was made, throws a ConflictError and changes nothing.
 */
export async function applyProposal(
  proposal: MemoryProposal,
  units: readonly MemoryUnit[],
  store: UnitStore,
  now: string,
): Promise<string | null> {
  const rules = runRules('learned', proposal.origin, true);
  switch (proposal.kind) {
    case 'skill': {
      const { name, description, body } = proposal;
      return (await createAtdSkill({ name, description, body })).name;
    }
    case 'create': {
      if (proposal.type === null) throw new TypeError('This suggestion names no memory type.');
      const { name, description, type, category, body } = proposal;
      await store.create(draftNew({ name, description, type, category, body }, rules, units, now));
      return null;
    }
    case 'update': {
      const patch = { description: proposal.description, body: proposal.body };
      const update = draftPatch(target(proposal, units), patch, rules, units, now);
      if (update.changed) await store.overwrite(update.draft, update.content);
      return null;
    }
    case 'core': {
      const unit = target(proposal, units);
      if (unit.activation === 'core') return null;
      if (!coreFits(units, unit))
        throw new ConflictError(
          `Always-on memories are limited to ${CORE_BUDGET} characters. Make another memory less prominent first.`,
        );
      // The user grants always-on by accepting, which the learner's own rules never do.
      const granted = draftPatch(
        unit,
        { activation: 'core' },
        { ...rules, core: true },
        units,
        now,
      );
      await store.overwrite(granted.draft, false);
      return null;
    }
    case 'remove':
      await store.trash(target(proposal, units).id);
      return null;
  }
}

/** The unit a suggestion is about, as it was when the suggestion was made. */
function target(proposal: MemoryProposal, units: readonly MemoryUnit[]): MemoryUnit {
  const unit = units.find((item) => item.id === proposal.unitId);
  if (!unit)
    throw new ConflictError(
      'The memory this suggestion is about no longer exists. Dismiss the suggestion.',
    );
  if (proposal.revision !== null && proposal.revision !== unit.revision)
    throw new ConflictError('This memory changed. Reload it before editing.');
  return unit;
}
