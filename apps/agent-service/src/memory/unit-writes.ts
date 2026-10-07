import { randomUUID } from 'node:crypto';
import {
  MemoryUnitSchema,
  parse,
  type MemoryOrigin,
  type MemorySource,
  type MemoryTarget,
  type MemoryUnit,
} from '@atd/agent-contracts';
import { ConflictError } from '../errors.js';
import type { MemoryUnitInput, MemoryUnitPatch } from './engine-types.js';
import { scanContent } from './scanner.js';
import { draftOf, type UnitDraft } from './unit.js';
import { deriveName, isMemoryName, slugifyName, uniqueName } from './unit-names.js';

/**
 * How a write turns an input or a patch into a unit draft. Every write normalizes the text, checks
 * the unit limits and scans the content; who writes decides the rest (`DraftRules`).
 */

export const MAX_DESCRIPTION = 300;
export const MAX_BODY = 20000;

/** What a writer records, how strictly it treats names and whether it may grant always-on. */
export interface DraftRules {
  source: MemorySource;
  /** The task a tool or learner wrote from; null keeps a patched unit's origin. */
  origin: MemoryOrigin | null;
  reviewed: boolean;
  /** `exact` refuses a malformed or taken name (Settings); `suffix` slugs it and makes it unique. */
  names: 'exact' | 'suffix';
  /**
   * Whether the writer puts units in always-on (`core`) and takes them out. Only the user does,
   * in Settings or by accepting a suggestion; a tool's request for `core` becomes a suggestion
   * (engine.ts), and other writers leave the membership as it is.
   */
  core: boolean;
}

/** Settings: the user's own names and choices, taken as given. */
export const USER_RULES: DraftRules = {
  source: 'user',
  origin: null,
  reviewed: true,
  names: 'exact',
  core: true,
};

/**
 * A tool or learner writing from `origin`. Agent writes happen in the user's conversation and count
 * as reviewed; learned ones wait for the user unless they accepted them as a suggestion.
 */
export function runRules(
  source: 'agent' | 'learned',
  origin: MemoryOrigin | null,
  reviewed = source === 'agent',
): DraftRules {
  return { source, origin, reviewed, names: 'suffix', core: false };
}

/** A description on one line, as the memory index lists it. */
export function normalizeDescription(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** A body with plain newlines and no outer blank space, as the unit file round-trips it. */
export function normalizeBody(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}

/** Throws a TypeError when the text breaks the unit limits or the content scan blocks it. */
export function checkContent(description: string, body: string): void {
  if (!description || description.length > MAX_DESCRIPTION)
    throw new TypeError(`A memory description must be 1–${MAX_DESCRIPTION} characters.`);
  if (!body || body.length > MAX_BODY)
    throw new TypeError(`A memory must have 1–${MAX_BODY} characters of text.`);
  const blocked = scanContent(`${description}\n${body}`);
  if (blocked) throw new TypeError(blocked);
}

function pickName(
  raw: string | undefined,
  description: string,
  type: MemoryTarget,
  taken: ReadonlySet<string>,
  mode: DraftRules['names'],
): string {
  if (raw === undefined) return deriveName(description, type, taken);
  if (mode === 'exact') {
    if (!isMemoryName(raw))
      throw new TypeError(
        'A memory name must be lowercase letters and digits in words joined by single hyphens, at most 64 characters.',
      );
    if (taken.has(raw))
      throw new ConflictError(`A memory named "${raw}" already exists. Choose another name.`);
    return raw;
  }
  const slug = slugifyName(raw);
  return slug ? uniqueName(slug, taken) : deriveName(description, type, taken);
}

/** Validates a finished draft against the wire unit; a failure is a bad input (TypeError). */
function checked(draft: UnitDraft): UnitDraft {
  parse(MemoryUnitSchema, { ...draft, revision: 'pending' });
  return draft;
}

/** The draft of a new, enabled unit among `units`. */
export function draftNew(
  input: MemoryUnitInput,
  rules: DraftRules,
  units: readonly UnitDraft[],
  now: string,
): UnitDraft {
  const description = normalizeDescription(input.description);
  const body = normalizeBody(input.body);
  checkContent(description, body);
  const taken = new Set(units.map((unit) => unit.name));
  const requested = input.activation ?? 'index';
  const draft: UnitDraft = {
    id: randomUUID(),
    name: pickName(input.name, description, input.type, taken, rules.names),
    description,
    type: input.type,
    category: input.category ?? null,
    activation: requested === 'core' && !rules.core ? 'index' : requested,
    enabled: true,
    source: rules.source,
    origin: rules.origin,
    reviewed: rules.reviewed,
    created: now,
    updated: now,
    body,
  };
  return checked(draft);
}

/**
 * `unit` with `patch` applied. Content (name, description, type, category, body) changes record
 * the writer, the time and the review state and keep a history version; `activation` alone is a
 * setting and leaves them. A writer without `core` rights keeps the unit in or out of always-on
 * as it was. `changed` is false when the patch changes nothing.
 */
export function draftPatch(
  unit: MemoryUnit,
  patch: MemoryUnitPatch,
  rules: DraftRules,
  units: readonly UnitDraft[],
  now: string,
): { draft: UnitDraft; content: boolean; changed: boolean } {
  const description =
    patch.description === undefined ? unit.description : normalizeDescription(patch.description);
  const body = patch.body === undefined ? unit.body : normalizeBody(patch.body);
  if (description !== unit.description || body !== unit.body) checkContent(description, body);
  const type = patch.type ?? unit.type;
  const category = patch.category === undefined ? unit.category : patch.category;
  const others = new Set(units.filter((item) => item.id !== unit.id).map((item) => item.name));
  const name =
    patch.name === undefined || patch.name === unit.name
      ? unit.name
      : pickName(patch.name, description, type, others, rules.names);
  const content =
    name !== unit.name ||
    description !== unit.description ||
    type !== unit.type ||
    category !== unit.category ||
    body !== unit.body;
  const draft: UnitDraft = {
    ...draftOf(unit),
    name,
    description,
    type,
    category,
    body,
    ...(content
      ? {
          source: rules.source,
          origin: rules.origin ?? unit.origin,
          reviewed: rules.reviewed,
          updated: now,
        }
      : {}),
  };
  const requested = patch.activation ?? unit.activation;
  const crossesCore = (requested === 'core') !== (unit.activation === 'core');
  draft.activation = crossesCore && !rules.core ? unit.activation : requested;
  const changed = content || draft.activation !== unit.activation;
  return { draft: checked(draft), content, changed };
}
