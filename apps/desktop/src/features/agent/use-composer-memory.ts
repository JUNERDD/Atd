import { Type, type Static } from 'typebox';
import { Identifier, RunContextChoiceSchema, type ModelAlias } from '@atd/agent-contracts';
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

/** The alias, model, context, and effort a composer picked; the rest of a run's policy is not remembered. */
const ModelChoiceSchema = Type.Object(
  {
    aliasId: Type.Optional(Identifier),
    modified: Type.Optional(Type.Literal(true)),
    model: Type.Optional(ModelReferenceSchema),
    contextChoice: Type.Optional(RunContextChoiceSchema),
    thinkingLevel: Type.Optional(ModelThinkingLevelSchema),
  },
  { additionalProperties: false },
);
export type ModelChoice = Static<typeof ModelChoiceSchema>;

const DRAFTS = { isEmpty: isEmptyDraft, restore: normalizeDraft };
const CHOICES = {
  isEmpty: (choice: ModelChoice) =>
    !choice.aliasId && !choice.model && !choice.contextChoice && !choice.thinkingLevel,
};

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

function usableModel(
  candidate: ModelChoice,
  connections: readonly Connection[] | undefined,
): ModelChoice | undefined {
  if (CHOICES.isEmpty(candidate)) return undefined;
  const model = candidate.model;
  if (model) {
    const connection = connections?.find((item) => item.connectionId === model.connectionId);
    if (!connection?.catalog.some((item) => item.id === model.modelId)) return undefined;
  }
  return candidate;
}

/**
 * The remembered choice, unless its model has gone since: the connection was removed or the model
 * left its catalog. When `aliases` is loaded, an unmodified alias choice resolves to the live
 * alias's current tuple, and a removed alias drops its id while keeping the remaining
 * model/context/effort choice. A choice that is unusable shows and runs as the default, while the
 * stored value stays until another pick replaces it.
 */
export function usableChoice(
  choice: ModelChoice | undefined,
  connections: readonly Connection[] | undefined,
  aliases?: readonly ModelAlias[],
): ModelChoice | undefined {
  if (!choice) return choice;
  if (choice.aliasId && aliases) {
    const live = aliases.find((item) => item.id === choice.aliasId);
    if (!live) {
      const { aliasId: _a, modified: _m, ...rest } = choice;
      return usableModel(rest, connections);
    }
    if (!choice.modified) {
      const liveChoice: ModelChoice = {
        aliasId: live.id,
        model: { connectionId: live.connectionId, modelId: live.modelId },
        ...(live.contextChoice ? { contextChoice: live.contextChoice } : {}),
        ...(live.thinkingLevel ? { thinkingLevel: live.thinkingLevel } : {}),
      };
      return usableModel(liveChoice, connections);
    }
  }
  return usableModel(choice, connections);
}

/** Moves a draft typed while a launched command's task id was still provisional onto `to`. */
export function rekeyDraft(drafts: ComposerDrafts, from: string, to: string): ComposerDrafts {
  if (from === to || !(from in drafts)) return drafts;
  const { [from]: draft, ...rest } = drafts;
  return draft ? { ...rest, [to]: draft } : rest;
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
