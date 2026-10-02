import { useId, useState } from 'react';
import { Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SubagentPermissions } from '@atd/agent-contracts';
import { Badge } from '@atd/ui/components/badge';
import { Button } from '@atd/ui/components/button';
import { Label } from '@atd/ui/components/label';
import { AgentPermissionsDialog } from './extension-agent-permissions';
import { ExtensionDetailFields } from './extension-detail-fields';
import type { ExtensionAgentRow } from './extension-rows';

/**
 * A subagent's permissions for later runs on its details page: the tools and approval they use,
 * and Edit permissions… opening the same dialog as the row's More menu. A listed tool set stays
 * within the task's tools, one without a list inherits them, and the approval names the tier the
 * agent asks for beyond the task's.
 */
export function AgentPermissionsSection({
  row,
  disabled,
  pending,
  onPermissions,
}: {
  row: ExtensionAgentRow;
  /** Locks Edit permissions… and the dialog while the service is disconnected. */
  disabled: boolean;
  /** A save is running: the dialog's actions keep their focus but ignore presses. */
  pending: boolean;
  onPermissions: (name: string, permissions: SubagentPermissions | null) => Promise<boolean>;
}) {
  const { t } = useTranslation('settings');
  const headingId = useId();
  const [open, setOpen] = useState(false);
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
    <section className="settings-field" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Label id={headingId}>{t('extensions.agentPage.permissions')}</Label>
          {row.customized ? (
            <Badge variant="secondary">{t('extensions.customPermissions')}</Badge>
          ) : null}
        </div>
        <Button type="button" variant="outline" disabled={disabled} onClick={() => setOpen(true)}>
          <Shield data-icon="inline-start" />
          {t('extensions.agentPage.editPermissions')}
        </Button>
      </div>
      <ExtensionDetailFields
        fields={[
          { label: t('extensions.detailTools'), value: toolsText },
          { label: t('extensions.detailApproval'), value: approvalText },
        ]}
      />
      <AgentPermissionsDialog
        row={row}
        open={open}
        onOpenChange={setOpen}
        disabled={disabled}
        pending={pending}
        onSave={(value) => onPermissions(row.name, value)}
      />
    </section>
  );
}
