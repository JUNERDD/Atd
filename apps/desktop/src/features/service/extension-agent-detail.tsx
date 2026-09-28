import { useTranslation } from 'react-i18next';
import { ExtensionDetailDialog } from './extension-detail-dialog';
import type { ExtensionAgentRow } from './extension-rows';

/**
 * Subagent details from its catalog row, with the permissions later runs use. A listed tool set
 * says it stays within the task's tools, one without a list inherits them, and the approval names
 * the tier the agent asks for beyond the task's (Settings › Permissions…).
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
  const { tools, approval } = row.permissions;
  const toolsText = tools
    ? t('extensions.agentToolsWithinTask', { tools: tools.join(', ') })
    : t('extensions.agentToolsFromTask');
  const approvalText =
    approval === 'manual'
      ? t('permissions.tiers.manual.label')
      : approval === 'auto'
        ? t('permissions.tiers.auto.label')
        : t('extensions.agentPermissions.approvalTask');
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
        { label: t('extensions.detailTools'), value: toolsText },
        { label: t('extensions.detailApproval'), value: approvalText },
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
