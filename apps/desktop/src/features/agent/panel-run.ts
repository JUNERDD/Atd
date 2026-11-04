import { runModelSelection, type RunModelSources } from '@atd/agent-contracts';
import type { PreparedCommand } from '../../client/agent/bridge';
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
  sources: Omit<RunModelSources, 'hasConnection'>,
): ModelReference | null {
  const connections = snapshot?.connections ?? [];
  const selected = runModelSelection({
    ...sources,
    hasConnection: (connectionId) => connections.some((item) => item.connectionId === connectionId),
  });
  if (selected) return selected;
  const fallback = connections.find(
    (connection) => connection.connectionId === snapshot?.defaultConnectionId,
  );
  return fallback?.defaultModel
    ? { connectionId: fallback.connectionId, modelId: fallback.defaultModel }
    : null;
}
