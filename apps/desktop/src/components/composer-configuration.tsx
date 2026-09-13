import type { RunPolicy } from '../../electron/agent/run-policy';
import type { Connection, ModelReference } from '../../electron/providers/schema';
import { TaskPolicyControl } from '../features/agent/task-policy';
import { ModelPicker } from '../features/providers/model-picker';
import '../features/providers/providers.css';

interface ComposerConfigurationProps {
  policy: RunPolicy;
  onPolicyChange: (policy: RunPolicy) => void;
  connections: Connection[];
  model: ModelReference | null;
  onOpenSettings: () => void;
}
export function ComposerConfiguration({
  connections,
  model,
  onOpenSettings,
  policy,
  onPolicyChange,
}: ComposerConfigurationProps) {
  return (
    <div className="composer-configuration" aria-label="Task configuration">
      <TaskPolicyControl value={policy} onChange={onPolicyChange} />
      <ModelPicker
        compact
        connections={connections}
        value={policy.model ?? model}
        label={`Models: ${policy.model?.modelId ?? model?.modelId ?? 'Choose model'}`}
        onChange={(model) => onPolicyChange({ ...policy, useDefaultModel: false, model })}
        onOpenProviders={onOpenSettings}
      />
    </div>
  );
}
