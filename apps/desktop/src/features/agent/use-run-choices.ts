import { useState } from 'react';
import type { ModelAlias } from '@atd/agent-contracts';
import type { PreparedCommand } from '../../client/agent/bridge';
import { launchSettings } from '../../client/agent/command-prepare';
import type { RunPolicy } from '../../client/agent/run-policy';
import type { TaskRun } from '../../client/agent/task-schema';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { sameRunContextChoice } from '../providers/use-model-contexts';
import { defaultRunPolicy, panelRunModel } from './panel-run';
import { readChoices, usableChoice, type ModelChoice } from './use-composer-memory';

/** Converts a saved model alias into a remembered composer choice carrying its 4-tuple. */
export function choiceFromAlias(alias: ModelAlias): ModelChoice {
  return {
    aliasId: alias.id,
    model: { connectionId: alias.connectionId, modelId: alias.modelId },
    ...(alias.contextChoice ? { contextChoice: alias.contextChoice } : {}),
    ...(alias.thinkingLevel ? { thinkingLevel: alias.thinkingLevel } : {}),
  };
}

function policyModelFields(
  choice: ModelChoice | undefined,
): Pick<RunPolicy, 'model' | 'contextChoice' | 'thinkingLevel'> {
  if (!choice) return {};
  return {
    ...(choice.model ? { model: choice.model } : {}),
    ...(choice.contextChoice ? { contextChoice: choice.contextChoice } : {}),
    ...(choice.thinkingLevel ? { thinkingLevel: choice.thinkingLevel } : {}),
  };
}

function resolveImplicitDefaultAlias(
  snapshot: SettingsSnapshot | null,
  choice: ModelChoice | undefined,
  inputStep: PreparedCommand | null,
  last: TaskRun | undefined,
): ModelAlias | undefined {
  if (choice || inputStep || last?.snapshot.model || !snapshot?.defaultAliasId) return undefined;
  const alias = snapshot.aliases.find((item) => item.id === snapshot.defaultAliasId);
  if (!alias) return undefined;
  const connection = snapshot.connections.find((item) => item.connectionId === alias.connectionId);
  return connection?.connected && connection.catalog.some((item) => item.id === alias.modelId)
    ? alias
    : undefined;
}

/**
 * What the panel's next run for `key` uses — a conversation's, `new`'s, or a command input step's
 * (`command-<id>`) — and how the composer changes it. The alias, model, context, and effort picked
 * for a key stay remembered (`choices`, which the panel persists); the rest of the policy stays
 * staged until a run takes it (`drop`). Unstaged, a run uses the defaults from the input step,
 * the conversation's last run (`last`), or the default alias on a fresh new chat.
 */
export function useRunChoices(
  snapshot: SettingsSnapshot | null,
  key: string,
  inputStep: PreparedCommand | null,
  last: TaskRun | undefined,
) {
  const [policies, setPolicies] = useState<Record<string, RunPolicy>>({});
  const [choices, setChoices] = useState(readChoices);
  // The alias/model/context/effort belong to the conversation's memory; the policy stages the rest.
  const explicitChoice = usableChoice(choices[key], snapshot?.connections, snapshot?.aliases);
  const implicitAlias = resolveImplicitDefaultAlias(snapshot, explicitChoice, inputStep, last);
  const choice = explicitChoice ?? (implicitAlias ? choiceFromAlias(implicitAlias) : undefined);
  const policy: RunPolicy = {
    ...(policies[key] ?? defaultRunPolicy(inputStep, last)),
    ...policyModelFields(choice),
  };
  return {
    choices,
    activeChoice: choice,
    policy,
    /** Something was staged or picked for the run; otherwise the service applies its defaults. */
    chosen: Boolean(policies[key] || choice),
    // A command run starts from its launching shortcut's model, if any.
    model: panelRunModel(snapshot, {
      requested: policy.model ?? null,
      command: inputStep ? launchSettings(inputStep).model : null,
      last: inputStep ? null : (last?.snapshot.model ?? null),
    }),
    change: ({ model, contextChoice, thinkingLevel, ...staged }: RunPolicy) => {
      setPolicies((previous) => ({ ...previous, [key]: staged }));
      const sameDimensions =
        model?.connectionId === choice?.model?.connectionId &&
        model?.modelId === choice?.model?.modelId &&
        sameRunContextChoice(contextChoice, choice?.contextChoice) &&
        (thinkingLevel ?? undefined) === (choice?.thinkingLevel ?? undefined);
      if (!explicitChoice && sameDimensions) return;
      const nextChoice: ModelChoice = {
        ...(choice?.aliasId ? { aliasId: choice.aliasId } : {}),
        ...(model ? { model } : {}),
        ...(contextChoice ? { contextChoice } : {}),
        ...(thinkingLevel ? { thinkingLevel } : {}),
      };
      setChoices((previous) => {
        if (
          !nextChoice.aliasId &&
          !nextChoice.model &&
          !nextChoice.contextChoice &&
          !nextChoice.thinkingLevel
        ) {
          const updated = { ...previous };
          delete updated[key];
          return updated;
        }
        return { ...previous, [key]: nextChoice };
      });
    },
    /** Atomically switches or restores the remembered choice for `key`. */
    setChoice: (next: ModelChoice | undefined) =>
      setChoices((previous) => {
        const updated = { ...previous };
        if (next) updated[key] = next;
        else delete updated[key];
        return updated;
      }),
    /** Stages `staged` for another key, as a seeded new chat does for `new`. */
    stage: (other: string, staged: RunPolicy) =>
      setPolicies((previous) => ({ ...previous, [other]: staged })),
    /** A run took the key's staged policy. */
    drop: () =>
      setPolicies((previous) => {
        const next = { ...previous };
        delete next[key];
        return next;
      }),
    /** Conversation `taskId`, which a run started, keeps the alias/model/context/effort sent with it. */
    remember: (taskId: string) => {
      if (choice) setChoices((previous) => ({ ...previous, [taskId]: choice }));
    },
  };
}
