import { useTranslation } from 'react-i18next';
import type { RunPolicy } from '../../electron/agent/run-policy';
import type { AgentTask } from '../../electron/agent/task-schema';
import type { Connection, ModelReference } from '../../electron/providers/schema';
import { PermissionTierControl } from '../features/agent/permission-tier-control';
import { TaskPolicyControl } from '../features/agent/task-policy';
import { ModelPicker } from '../features/providers/model-picker';
import { ThinkingLevelSelect } from '../features/providers/thinking-level-select';
import '../features/providers/providers.css';

interface ComposerConfigurationProps {
  policy: RunPolicy;
  onPolicyChange: (policy: RunPolicy) => void;
  connections: Connection[];
  model: ModelReference | null;
  onOpenSettings: () => void;
  taskId: string | null;
  task: AgentTask | null;
}
export function ComposerConfiguration({
  connections,
  model,
  onOpenSettings,
  policy,
  onPolicyChange,
  taskId,
  task,
}: ComposerConfigurationProps) {
  const { t } = useTranslation('panel');
  const shown = policy.model ?? model;
  const connection = connections.find((item) => item.connectionId === shown?.connectionId);
  return (
    <div className="composer-configuration" aria-label={t('configuration.label')}>
      <div className="composer-policy-group">
        <PermissionTierControl taskId={taskId} task={task} />
        <TaskPolicyControl value={policy} onChange={onPolicyChange} />
      </div>
      <div className="composer-model-group">
        <ModelPicker
          compact
          connections={connections}
          value={shown}
          label={t('configuration.models', {
            model: policy.model?.modelId ?? model?.modelId ?? t('configuration.chooseModel'),
          })}
          onChange={(model) => onPolicyChange({ ...policy, useDefaultModel: false, model })}
          onOpenProviders={onOpenSettings}
        />
        <ThinkingLevelSelect
          compact
          reference={shown}
          value={policy.thinkingLevel ?? connection?.defaultThinkingLevel ?? 'off'}
          label={t('configuration.thinkingLevel')}
          onChange={(thinkingLevel) => onPolicyChange({ ...policy, thinkingLevel })}
        />
      </div>
    </div>
  );
}
