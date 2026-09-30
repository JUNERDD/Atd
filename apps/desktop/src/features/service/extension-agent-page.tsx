import { useId, type ReactNode } from 'react';
import { Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SubagentPermissions } from '@ai/agent-contracts';
import { Button } from '@ai/ui/components/button';
import { EMPTY_AGENT_DRAFT, agentDraftOf, type AgentInput } from './extension-agent-draft';
import { AgentForm } from './extension-agent-form';
import { AgentPermissionsSection } from './extension-agent-permissions-section';
import {
  ExtensionDetailFields,
  ExtensionDetailStatus,
  ExtensionDetailText,
} from './extension-detail-fields';
import { ExtensionPage } from './extension-page';
import { ExtensionRemoveButton } from './extension-remove-dialog';
import type { ExtensionAgentRow } from './extension-rows';

export type { AgentInput } from './extension-agent-draft';

/**
 * Subagent sub-page. `name` null is the add page (a Personal agent); a name is that subagent's
 * details: an editable form for a Personal markdown agent (`~/.atd/agents`, saved by overwriting
 * its file) and read-only facts for a system agent or an installed plugin's, all with its
 * permissions for later runs, which a plugin's agent may override too. A plugin's agent offers
 * Duplicate to Personal to change the rest; a Personal agent offers Delete, which removes its file
 * after a confirmation. A name not in `rows` shows as loading while the catalog is still empty (it
 * always lists the system agents once loaded) and as missing otherwise.
 * The root leaves the page after a successful save, so it stays on a failure for repair.
 */
export function AgentPage({
  name,
  rows,
  pluginName,
  backLabel,
  connected,
  busy,
  onBack,
  onSave,
  onPermissions,
  onStartAi,
  onDuplicate,
  onDelete,
}: {
  name: string | null;
  rows: readonly ExtensionAgentRow[];
  /** The contributing plugin, named as a read-only agent's source. */
  pluginName: string;
  backLabel: string;
  connected: boolean;
  busy: boolean;
  onBack: () => void;
  onSave: (input: AgentInput) => Promise<boolean>;
  onPermissions: (name: string, permissions: SubagentPermissions | null) => Promise<boolean>;
  onStartAi: (target: string | null) => void;
  onDuplicate: () => void;
  /** Deletes the Personal agent once the confirmation is accepted. */
  onDelete: () => void;
}) {
  const { t } = useTranslation('settings');
  const formId = useId();
  const locked = !connected || busy;
  const save = (input: AgentInput) => void onSave(input);
  const actions = (submitLabel: string, remove: ReactNode = null) => (
    <>
      {remove}
      <Button type="button" variant="glass" onClick={onBack}>
        {t('extensions.cancel')}
      </Button>
      <Button type="submit" form={formId} disabled={locked}>
        {submitLabel}
      </Button>
    </>
  );

  if (name === null) {
    const title = t('extensions.addSubagent');
    return (
      <ExtensionPage
        label={title}
        title={title}
        description={t('extensions.agentPage.addDescription')}
        backLabel={backLabel}
        ai={{
          label: t('extensions.createWithAi'),
          disabled: locked,
          onClick: () => onStartAi(null),
        }}
        actions={actions(t('extensions.agentPage.create'))}
      >
        <AgentForm
          formId={formId}
          initial={EMPTY_AGENT_DRAFT}
          takenNames={rows.map((row) => row.name)}
          customized={false}
          disabled={locked}
          onSubmit={save}
        />
      </ExtensionPage>
    );
  }

  const row = rows.find((entry) => entry.name === name);
  if (!row)
    return (
      <ExtensionPage label={name} title={name} backLabel={backLabel}>
        <ExtensionDetailStatus
          text={rows.length ? t('extensions.detailMissing') : t('extensions.detailLoading')}
          error={rows.length > 0}
        />
      </ExtensionPage>
    );

  const page = {
    label: row.name,
    title: row.name,
    badge: row.enabled
      ? { label: t('extensions.stateEnabled'), tone: 'on' as const }
      : { label: t('extensions.stateDisabled'), tone: 'off' as const },
    description: row.description || t('extensions.detailNoDescription'),
    backLabel,
  };
  const permissions = (
    <AgentPermissionsSection row={row} disabled={locked} onPermissions={onPermissions} />
  );

  if (row.system || row.readOnly)
    return (
      <ExtensionPage
        {...page}
        actions={
          row.readOnly && !row.system ? (
            <Button type="button" variant="glass" disabled={locked} onClick={onDuplicate}>
              <Copy data-icon="inline-start" />
              {t('extensions.plugins.item.duplicate')}
            </Button>
          ) : null
        }
      >
        <ExtensionDetailFields
          fields={[
            {
              label: t('extensions.detailSource'),
              value: row.system ? t('extensions.sourceSystem') : pluginName,
            },
            {
              label: t('extensions.detailModel'),
              value: row.model || t('extensions.agentTaskModel'),
              mono: Boolean(row.model),
            },
          ]}
        />
        {permissions}
        <ExtensionDetailText label={t('extensions.agentSystemPrompt')} value={row.systemPrompt} />
      </ExtensionPage>
    );

  return (
    <ExtensionPage
      {...page}
      ai={{
        label: t('extensions.editWithAi'),
        disabled: locked,
        onClick: () => onStartAi(row.name),
      }}
      actions={actions(
        t('extensions.agentPage.save'),
        <ExtensionRemoveButton
          name={row.name}
          label={t('extensions.delete')}
          title={t('extensions.deleteTitle', { name: row.name })}
          description={t('extensions.deleteAgentDescription')}
          disabled={locked}
          onConfirm={onDelete}
        />,
      )}
    >
      <ExtensionDetailFields
        fields={[
          {
            label: t('extensions.detailSource'),
            value: t('extensions.sourceAtdAgents'),
            mono: true,
          },
        ]}
      />
      <AgentForm
        key={row.name}
        formId={formId}
        initial={agentDraftOf(row)}
        takenNames={null}
        customized={row.customized}
        disabled={locked}
        onSubmit={save}
      />
      {permissions}
    </ExtensionPage>
  );
}
