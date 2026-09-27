import { useTranslation } from 'react-i18next';
import type { TaskContextState } from '@ai/agent-contracts';
import type { RunPolicy } from '../../electron/agent/run-policy';
import type { AgentTask } from '../../electron/agent/task-schema';
import type { Connection, ModelReference } from '../../electron/providers/schema';
import { ContextUsageRing } from '../features/agent/compaction/context-usage-ring';
import { PermissionTierControl } from '../features/agent/permission-tier-control';
import { ModelConfigPopover } from '../features/providers/model-config-popover';
import '../features/providers/providers.css';

interface ComposerConfigurationProps {
  policy: RunPolicy;
  onPolicyChange: (policy: RunPolicy) => void;
  connections: Connection[];
  model: ModelReference | null;
  onOpenSettings: () => void;
  taskId: string | null;
  task: AgentTask | null;
  /** The open task's context usage; the ring beside the model trigger hides without a task. */
  context: TaskContextState | null;
}
export function ComposerConfiguration({
  connections,
  model,
  onOpenSettings,
  policy,
  onPolicyChange,
  taskId,
  task,
  context,
}: ComposerConfigurationProps) {
  const { t } = useTranslation('panel');
  const shown = policy.model ?? model ?? null;
  const connection = connections.find((item) => item.connectionId === shown?.connectionId);
  return (
    <div className="composer-configuration" aria-label={t('configuration.label')}>
      <div className="composer-policy-group">
        <PermissionTierControl taskId={taskId} task={task} />
      </div>
      <div className="composer-model-group">
        {taskId && context && <ContextUsageRing context={context} />}
        <ModelConfigPopover
          compact
          connections={connections}
          model={shown}
          thinkingLevel={policy.thinkingLevel ?? connection?.defaultThinkingLevel ?? 'off'}
          onModelChange={(next) =>
            onPolicyChange({ ...policy, useDefaultModel: false, model: next })
          }
          onThinkingLevelChange={(thinkingLevel) => onPolicyChange({ ...policy, thinkingLevel })}
          onOpenProviders={onOpenSettings}
        />
      </div>
    </div>
  );
}
