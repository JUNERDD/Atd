import { useTranslation } from 'react-i18next';
import { ExtensionDetailDialog } from './extension-detail-dialog';
import type { ExtensionAgentRow } from './extension-rows';

/**
 * Subagent details from its catalog row. A system agent has no tool list of its own: the task's
 * tools bound it, so the detail says that instead of showing an empty list.
 */
export function AgentDetailDialog({
  row,
  open,
  onOpenChange,
}: {
  row: ExtensionAgentRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('settings');
  const tools = row.system
    ? t('extensions.agentToolsFromTask')
    : row.tools.length
      ? row.tools.join(', ')
      : t('extensions.agentNoTools');
  return (
    <ExtensionDetailDialog
      open={open}
      onOpenChange={onOpenChange}
      title={row.name}
      description={row.description || t('extensions.detailNoDescription')}
      badge={
        row.enabled
          ? { label: t('extensions.stateEnabled'), tone: 'on' }
          : { label: t('extensions.stateDisabled'), tone: 'off' }
      }
      wide
      fields={[
        {
          label: t('extensions.detailSource'),
          value: row.system ? t('extensions.sourceSystem') : t('extensions.sourceAtdAgents'),
        },
        { label: t('extensions.detailTools'), value: tools },
        {
          label: t('extensions.detailModel'),
          value: row.model || t('extensions.agentTaskModel'),
          mono: Boolean(row.model),
        },
      ]}
      text={{ label: t('extensions.agentSystemPrompt'), value: row.systemPrompt }}
    />
  );
}
