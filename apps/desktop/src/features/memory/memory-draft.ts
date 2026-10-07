import { Value } from 'typebox/value';
import {
  MemoryBodySchema,
  MemoryDescriptionSchema,
  MemoryNameSchema,
  type MemoryActivation,
  type MemoryCategory,
  type MemoryCreateRequest,
  type MemorySaveRequest,
  type MemoryTarget,
  type MemoryUnit,
} from '@atd/agent-contracts';

/** The fields the memory page edits, as typed; requests carry them trimmed. */
export interface MemoryDraft {
  name: string;
  description: string;
  type: MemoryTarget;
  /** Offered only for the failure type; leaving that type clears it. */
  category: MemoryCategory | null;
  activation: MemoryActivation;
  body: string;
}

/** The fields a draft can be wrong in, in page order, so a failed save focuses the first. */
export const MEMORY_CHECKED_FIELDS = ['name', 'description', 'body'] as const;
export type MemoryCheckedField = (typeof MEMORY_CHECKED_FIELDS)[number];
export type MemoryDraftError =
  | 'nameRequired'
  | 'nameFormat'
  | 'nameTaken'
  | 'descriptionRequired'
  | 'bodyRequired';

export const MEMORY_LIMITS = { name: 64, description: 300, body: 20000 } as const;

/** A new memory starts as a preference in the memory index, as the service defaults it. */
const NEW_DRAFT: MemoryDraft = {
  name: '',
  description: '',
  type: 'memory',
  category: null,
  activation: 'index',
  body: '',
};

export function draftOf(unit: MemoryUnit | null): MemoryDraft {
  if (!unit) return NEW_DRAFT;
  const { name, description, type, category, activation, body } = unit;
  return { name, description, type, category, activation, body };
}

/** Whether two drafts would save the same fields (names and descriptions are saved trimmed). */
export function sameDraft(a: MemoryDraft, b: MemoryDraft): boolean {
  return (
    a.name.trim() === b.name.trim() &&
    a.description.trim() === b.description.trim() &&
    a.type === b.type &&
    a.category === b.category &&
    a.activation === b.activation &&
    a.body === b.body
  );
}

/** Whether two versions of a unit hold the same editable fields (a switch or review aside). */
export function sameContent(a: MemoryUnit, b: MemoryUnit): boolean {
  return sameDraft(draftOf(a), draftOf(b));
}

/** Changes the type; a category belongs to the failure type, so another type drops it. */
export function withType(draft: MemoryDraft, type: MemoryTarget): MemoryDraft {
  return { ...draft, type, category: type === 'failure' ? draft.category : null };
}

/**
 * What keeps the draft from saving, by field. A new memory may leave its name empty (the service
 * names it from the description); a saved one keeps a name. `takenNames` are the other units'.
 */
export function draftErrors(
  draft: MemoryDraft,
  { creating, takenNames }: { creating: boolean; takenNames: readonly string[] },
): Partial<Record<MemoryCheckedField, MemoryDraftError>> {
  const errors: Partial<Record<MemoryCheckedField, MemoryDraftError>> = {};
  const name = draft.name.trim();
  if (!name) {
    if (!creating) errors.name = 'nameRequired';
  } else if (!Value.Check(MemoryNameSchema, name)) errors.name = 'nameFormat';
  else if (takenNames.includes(name)) errors.name = 'nameTaken';
  if (!Value.Check(MemoryDescriptionSchema, draft.description.trim()))
    errors.description = 'descriptionRequired';
  if (!draft.body.trim() || !Value.Check(MemoryBodySchema, draft.body))
    errors.body = 'bodyRequired';
  return errors;
}

export function createRequestOf(draft: MemoryDraft): MemoryCreateRequest {
  const name = draft.name.trim();
  return {
    ...(name ? { name } : {}),
    description: draft.description.trim(),
    type: draft.type,
    category: draft.category,
    activation: draft.activation,
    body: draft.body,
  };
}

/**
 * The fields of `draft` that differ from `base` (the unit the draft started from) as a save at
 * `revision`; null when nothing changed.
 */
export function saveRequestOf(
  draft: MemoryDraft,
  base: MemoryUnit,
  revision: string,
): MemorySaveRequest | null {
  const name = draft.name.trim();
  const description = draft.description.trim();
  const changes: Omit<MemorySaveRequest, 'id' | 'revision'> = {
    ...(name === base.name ? {} : { name }),
    ...(description === base.description ? {} : { description }),
    ...(draft.type === base.type ? {} : { type: draft.type }),
    ...(draft.category === base.category ? {} : { category: draft.category }),
    ...(draft.activation === base.activation ? {} : { activation: draft.activation }),
    ...(draft.body === base.body ? {} : { body: draft.body }),
  };
  return Object.keys(changes).length ? { id: base.id, revision, ...changes } : null;
}
