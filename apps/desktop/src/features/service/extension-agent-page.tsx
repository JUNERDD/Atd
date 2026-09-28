import { useId } from 'react';
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
import type { ExtensionAgentRow } from './extension-rows';

export type { AgentInput } from './extension-agent-draft';

/**
 * Subagent sub-page. `name` null is the add page; a name is that subagent's details: an editable
 * form for a markdown agent (`~/.atd/agents`, saved by overwriting its file) and read-only facts
 * for a system agent, both with its permissions for later runs. A name not in `rows` shows as
 * loading while the catalog is still empty (it always lists the system agents once loaded) and as
 * missing otherwise. The root returns to the list after a successful save, so the page stays on a
 * failure for the user to repair.
 */
export function AgentPage({
  name,
  rows,
  connected,
  busy,
  onBack,
  onSave,
  onPermissions,
  onStartAi,
}: {
  name: string | null;
  rows: readonly ExtensionAgentRow[];
  connected: boolean;
  busy: boolean;
  onBack: () => void;
  onSave: (input: AgentInput) => Promise<boolean>;
  onPermissions: (name: string, permissions: SubagentPermissions | null) => Promise<boolean>;
  onStartAi: (target: string | null) => void;
}) {
  const { t } = useTranslation('settings');
  const formId = useId();
  const locked = !connected || busy;
  const backLabel = t('extensions.agentPage.back');
  const save = (input: AgentInput) => void onSave(input);
  const actions = (submitLabel: string) => (
    <>
      <Button type="button" variant="outline" onClick={onBack}>
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
        onBack={onBack}
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
      <ExtensionPage label={name} title={name} backLabel={backLabel} onBack={onBack}>
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
    onBack,
  };
  const permissions = (
    <AgentPermissionsSection row={row} disabled={locked} onPermissions={onPermissions} />
  );

  if (row.system)
    return (
      <ExtensionPage {...page}>
        <ExtensionDetailFields
          fields={[
            { label: t('extensions.detailSource'), value: t('extensions.sourceSystem') },
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
      actions={actions(t('extensions.agentPage.save'))}
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
