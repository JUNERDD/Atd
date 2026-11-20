import { useTranslation } from 'react-i18next';
import type { TaskContextState } from '@atd/agent-contracts';
import type { RunPolicy } from '../client/agent/run-policy';
import type { AgentTask } from '../client/agent/task-schema';
import type { Connection, ModelReference } from '../client/providers/schema';
import { ContextUsageRing } from '../features/agent/compaction/context-usage-ring';
import { MessageEntry } from '../features/agent/message-dial/message-entry';
import { PermissionTierControl } from '../features/agent/permission-tier-control';
import { withPolicyContext } from '../features/agent/panel-run';
import type { PanelAliasState } from '../features/agent/use-panel-aliases';
import { ModelConfigPopover } from '../features/providers/model-config-popover';
import '../features/providers/providers.css';

interface ComposerConfigurationProps {
  policy: RunPolicy;
  onPolicyChange: (policy: RunPolicy) => void;
  connections: Connection[];
  model: ModelReference | null;
  aliasState?: PanelAliasState | undefined;
  onOpenSettings: () => void;
  taskId: string | null;
  task: AgentTask | null;
  unsaved: boolean;
  /** The open task's context usage; the ring beside the model trigger hides without a task. */
  context: TaskContextState | null;
}
export function ComposerConfiguration({
  connections,
  model,
  aliasState,
  onOpenSettings,
  policy,
  onPolicyChange,
  taskId,
  task,
  unsaved,
  context,
}: ComposerConfigurationProps) {
  const { t } = useTranslation('panel');
  const shown = policy.model ?? model ?? null;
  const connection = connections.find((item) => item.connectionId === shown?.connectionId);
  return (
    <div className="composer-configuration" aria-label={t('configuration.label')}>
      <div className="composer-policy-group">
        {/* A chat the service has not created yet starts with the default tier, as a new one. */}
        <PermissionTierControl taskId={unsaved ? null : taskId} task={task} />
        <MessageEntry taskId={taskId} />
      </div>
      <div className="composer-model-group">
        {taskId && context && <ContextUsageRing taskId={taskId} context={context} />}
        <ModelConfigPopover
          compact
          connections={connections}
          model={shown}
          thinkingLevel={policy.thinkingLevel ?? connection?.defaultThinkingLevel}
          onModelChange={(next) => onPolicyChange({ ...policy, model: next })}
          onThinkingLevelChange={(thinkingLevel) => onPolicyChange({ ...policy, thinkingLevel })}
          onOpenProviders={onOpenSettings}
          aliases={aliasState?.aliases}
          activeAliasId={aliasState?.activeAlias?.id ?? null}
          aliasModified={aliasState?.aliasModified}
          cycleShortcut={aliasState?.cycleShortcut}
          onSelectAlias={aliasState?.onSelectAlias}
          onRestoreAlias={aliasState?.onRestoreAlias}
          onSaveAsAlias={aliasState?.onSaveAsAlias}
          draftContextChoice={policy.contextChoice}
          onContextChoiceChange={(contextChoice) =>
            onPolicyChange(withPolicyContext(policy, contextChoice))
          }
        />
      </div>
    </div>
  );
}
