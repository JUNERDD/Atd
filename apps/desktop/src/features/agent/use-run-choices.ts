import { useState } from 'react';
import type { PreparedCommand } from '../../client/agent/bridge';
import { launchSettings } from '../../client/agent/command-prepare';
import type { RunPolicy } from '../../client/agent/run-policy';
import type { TaskRun } from '../../client/agent/task-schema';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { defaultRunPolicy, panelRunModel } from './panel-run';
import { readChoices, usableChoice } from './use-composer-memory';

/**
 * What the panel's next run for `key` uses — a conversation's, `new`'s, or a command input step's
 * (`command-<id>`) — and how the composer changes it. The model and effort picked for a key stay
 * remembered (`choices`, which the panel persists); the rest of the policy stays staged until a
 * run takes it (`drop`). Unstaged, a run uses the defaults from the input step or the
 * conversation's last run (`last`): `defaultRunPolicy` and `panelRunModel`.
 */
export function useRunChoices(
  snapshot: SettingsSnapshot | null,
  key: string,
  inputStep: PreparedCommand | null,
  last: TaskRun | undefined,
) {
  const [policies, setPolicies] = useState<Record<string, RunPolicy>>({});
  const [choices, setChoices] = useState(readChoices);
  // The model and effort belong to the conversation's memory; the policy only stages the rest.
  const choice = usableChoice(choices[key], snapshot?.connections);
  const policy: RunPolicy = { ...(policies[key] ?? defaultRunPolicy(inputStep, last)), ...choice };
  return {
    choices,
    policy,
    /** Something was staged or picked for the run; otherwise the service applies its defaults. */
    chosen: Boolean(policies[key] || choice),
    // A command run starts from its launching shortcut's model, if any.
    model: panelRunModel(snapshot, {
      requested: policy.model ?? null,
      command: inputStep ? launchSettings(inputStep).model : null,
      last: inputStep ? null : (last?.snapshot.model ?? null),
    }),
    change: ({ model, thinkingLevel, ...staged }: RunPolicy) => {
      setPolicies((previous) => ({ ...previous, [key]: staged }));
      setChoices((previous) => ({
        ...previous,
        [key]: { ...(model ? { model } : {}), ...(thinkingLevel ? { thinkingLevel } : {}) },
      }));
    },
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
    /** Conversation `taskId`, which a run started, keeps the model and effort it was sent with. */
    remember: (taskId: string) => {
      if (choice) setChoices((previous) => ({ ...previous, [taskId]: choice }));
    },
  };
}
