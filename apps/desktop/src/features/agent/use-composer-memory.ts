import { Type, type Static } from 'typebox';
import {
  ModelReferenceSchema,
  ModelThinkingLevelSchema,
  type Connection,
} from '../../client/providers/schema';
import { isEmptyDraft, normalizeDraft } from '../composer-editor/draft';
import { ComposerDraftSchema } from '../composer-editor/draft-schema';
import { readPersistedRecord, usePersistRecord } from '../../lib/persisted-record';

const DRAFT_PREFIX = 'composer.draft.';
const CHOICE_PREFIX = 'composer.choice.';

/** The model and effort a composer picked; the rest of a run's policy is not remembered. */
const ModelChoiceSchema = Type.Object(
  {
    model: Type.Optional(ModelReferenceSchema),
    thinkingLevel: Type.Optional(ModelThinkingLevelSchema),
  },
  { additionalProperties: false },
);
export type ModelChoice = Static<typeof ModelChoiceSchema>;

const DRAFTS = { isEmpty: isEmptyDraft, restore: normalizeDraft };
const CHOICES = { isEmpty: (choice: ModelChoice) => !choice.model && !choice.thinkingLevel };

/**
 * What each conversation remembers of its composer, by key: `new` for the new conversation, else
 * the task's id. The draft and the model choice outlive the page, so a reopened panel finds both
 * as they were left: the panel starts its state from these and hands it to `useRememberComposers`.
 */
export type ComposerDrafts = ReturnType<typeof readDrafts>;
export type ModelChoices = ReturnType<typeof readChoices>;

export function readDrafts() {
  return readPersistedRecord(DRAFT_PREFIX, ComposerDraftSchema, DRAFTS);
}

export function readChoices() {
  return readPersistedRecord(CHOICE_PREFIX, ModelChoiceSchema, CHOICES);
}

/** Writes the panel's drafts and model choices back to storage as they change. */
export function useRememberComposers(drafts: ComposerDrafts, choices: ModelChoices) {
  usePersistRecord(DRAFT_PREFIX, drafts, DRAFTS);
  usePersistRecord(CHOICE_PREFIX, choices, CHOICES);
}

/**
 * The remembered choice, unless its model has gone since: the connection was removed or the model
 * left its catalog. A choice that is unusable shows and runs as the default, while the stored
 * value stays until another pick replaces it. `connections` is undefined until they load.
 */
export function usableChoice(
  choice: ModelChoice | undefined,
  connections: readonly Connection[] | undefined,
): ModelChoice | undefined {
  const model = choice?.model;
  if (!choice || !model) return choice;
  const connection = connections?.find((item) => item.connectionId === model.connectionId);
  return connection?.catalog.some((item) => item.id === model.modelId) ? choice : undefined;
}

/** Drops a deleted task's remembered composer from storage; the page never shows it again. */
export function forgetComposerMemory(taskId: string) {
  try {
    localStorage.removeItem(DRAFT_PREFIX + taskId);
    localStorage.removeItem(CHOICE_PREFIX + taskId);
  } catch {
    // Storage is unavailable: nothing was remembered.
  }
}
