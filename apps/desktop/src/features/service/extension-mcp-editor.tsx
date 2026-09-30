import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { ExtensionDetailSection } from './extension-detail-fields';
import {
  toUpsertInput,
  validateDraft,
  type McpDraft,
  type McpUpsertInput,
} from './extension-mcp-draft';
import type { ExtensionMcpConfig } from './extension-detail-rows';
import { McpConnectionFields } from './extension-mcp-form';
import { ExtensionPage, type ExtensionPageBadge } from './extension-page';

const FORM_ID = 'mcp-server-form';

/**
 * The MCP page with its connection form: the add page when `serverId` is null, otherwise that
 * server's details, with its status (`before`) above the form and anything the form cannot carry
 * over (`after`) below it. Save checks the draft here first, then hands it to `onUpsert`; the
 * route returns to the list when the save succeeds, and a failure keeps the page for repair.
 */
export function McpEditor({
  serverId,
  initial,
  takenIds,
  saved = null,
  badge,
  backLabel,
  connected,
  busy,
  before,
  after,
  onBack,
  onUpsert,
  onStartAi,
}: {
  serverId: string | null;
  initial: McpDraft;
  /** Ids the draft may not take: the catalog on the add page, nothing for an existing server. */
  takenIds: readonly string[];
  /** The stored server, whose kept env vars, headers and token limit what may change. */
  saved?: ExtensionMcpConfig | null;
  badge?: ExtensionPageBadge | null;
  backLabel: string;
  connected: boolean;
  busy: boolean;
  before?: ReactNode;
  after?: ReactNode;
  onBack: () => void;
  onUpsert: (input: McpUpsertInput) => Promise<boolean>;
  onStartAi: (target: string | null) => void;
}) {
  const { t } = useTranslation('settings');
  const [draft, setDraft] = useState(initial);
  // Problems show once a save was tried, then follow the edits so a fix clears its message.
  const [checked, setChecked] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const problems = checked ? validateDraft(draft, takenIds, saved) : {};
  const locked = !connected || busy;
  const adding = serverId === null;

  function submit() {
    if (locked) return;
    setChecked(true);
    const found = validateDraft(draft, takenIds, saved);
    if (Object.keys(found).length) {
      // The first invalid control takes focus once the messages render.
      requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      });
      return;
    }
    void onUpsert(toUpsertInput(draft));
  }

  const form = (
    <form
      ref={formRef}
      id={FORM_ID}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <fieldset className="settings-fields" disabled={locked}>
        <McpConnectionFields
          draft={draft}
          problems={problems}
          idReadOnly={!adding}
          onChange={setDraft}
        />
      </fieldset>
    </form>
  );

  return (
    <ExtensionPage
      label={adding ? t('extensions.mcpPage.addTitle') : t('extensions.mcpPage.label')}
      title={serverId ?? t('extensions.mcpPage.addTitle')}
      badge={badge}
      description={
        adding ? t('extensions.mcpPage.addDescription') : t('extensions.mcpDetailDescription')
      }
      backLabel={backLabel}
      ai={{
        label: adding ? t('extensions.createWithAi') : t('extensions.editWithAi'),
        disabled: locked,
        onClick: () => onStartAi(serverId),
      }}
      actions={
        <>
          <Button type="button" variant="outline" onClick={onBack}>
            {t('extensions.cancel')}
          </Button>
          <Button type="submit" form={FORM_ID} disabled={locked}>
            {adding ? t('extensions.addServer') : t('extensions.mcpPage.saveChanges')}
          </Button>
        </>
      }
    >
      {before}
      {adding ? (
        form
      ) : (
        <ExtensionDetailSection label={t('extensions.mcpPage.connectionSection')}>
          {form}
        </ExtensionDetailSection>
      )}
      {after}
    </ExtensionPage>
  );
}
