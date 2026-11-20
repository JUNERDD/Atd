import {
  runModelSelection,
  type RunContextChoice,
  type RunModelSources,
} from '@atd/agent-contracts';
import type { PreparedCommand, TaskDetail } from '../../client/agent/bridge';
import type { RunPolicy } from '../../client/agent/run-policy';
import type { TaskRun } from '../../client/agent/task-schema';
import type { ModelReference } from '../../client/providers/schema';
import type { SettingsSnapshot } from '../../client/settings-contract';

/**
 * The tools and memory the panel's next run stages until the person changes them: a command input
 * step's command's, else those of the conversation's last run (`last`), else a new chat's.
 */
export function defaultRunPolicy(
  inputStep: PreparedCommand | null,
  last: TaskRun | undefined,
): RunPolicy {
  const policy: Pick<RunPolicy, 'tools' | 'memory'> = inputStep
    ? { tools: inputStep.command.tools, memory: inputStep.command.memory !== 'off' }
    : last
      ? { tools: last.snapshot.tools, memory: last.snapshot.memory }
      : { tools: ['read', 'write', 'edit', 'bash', 'command'], memory: true };
  return { ...policy, confirmExpansion: false };
}

/**
 * The model a run of the panel will use, as the service selects it (`runModelSelection`), else
 * the default connection's default model: the composer's picker shows it, the composer and the
 * command input check it for image input before images are sent, and an outgoing message's turn
 * names it until its run does. Null while no saved connection offers one.
 */
export function panelRunModel(
  snapshot: SettingsSnapshot | null,
  sources: Omit<
    RunModelSources,
    'hasConnection' | 'aliases' | 'defaultAliasId' | 'isConnectionUsable'
  >,
): ModelReference | null {
  const connections = snapshot?.connections ?? [];
  const selected = runModelSelection({
    ...sources,
    ...(snapshot ? { aliases: snapshot.aliases, defaultAliasId: snapshot.defaultAliasId } : {}),
    hasConnection: (connectionId) => connections.some((item) => item.connectionId === connectionId),
    isConnectionUsable: (connectionId) =>
      connections.some((item) => item.connectionId === connectionId && item.connected),
  });
  if (selected) return selected;
  const fallback = connections.find(
    (connection) => connection.connectionId === snapshot?.defaultConnectionId,
  );
  return fallback?.defaultModel
    ? { connectionId: fallback.connectionId, modelId: fallback.defaultModel }
    : null;
}

/** Header title matching the active panel view and task/command state. */
export function panelViewTitle(
  view: 'new' | 'history' | 'apps' | 'task' | 'input',
  prepared: PreparedCommand | null,
  detail: TaskDetail | null,
  t: (
    key: 'titles.tasks' | 'titles.apps' | 'titles.commandInput' | 'titles.task' | 'titles.newTask',
  ) => string,
): string {
  switch (view) {
    case 'history':
      return t('titles.tasks');
    case 'apps':
      return t('titles.apps');
    case 'input':
      return prepared?.command.name ?? t('titles.commandInput');
    case 'task':
      return detail?.task.title ?? t('titles.task');
    case 'new':
      return t('titles.newTask');
  }
}

/** Updates `policy.contextChoice` cleanly under `exactOptionalPropertyTypes`. */
export function withPolicyContext(
  policy: RunPolicy,
  contextChoice: RunContextChoice | undefined,
): RunPolicy {
  if (contextChoice) return { ...policy, contextChoice };
  const { contextChoice: _, ...rest } = policy;
  return rest;
}
