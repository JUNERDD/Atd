import { useState } from 'react';
import { Bot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { HighlightedText } from '@ai/ui/components/highlighted-text';
import { Input } from '@ai/ui/components/input';
import { Textarea } from '@ai/ui/components/textarea';
import { ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@ai/ui/components/item';
import { matchFields } from '@ai/ui/lib/fuzzy-match';
import { AgentDetailDialog } from './extension-agent-detail';
import { ExtensionGroup } from './extension-group';
import { ExtensionRow, ExtensionRowActions } from './extension-row';
import { ROLE_TOOLS, type ExtensionAgentRow, type ExtensionRoleTool } from './extension-rows';

type AgentDraft = {
  name: string;
  description: string;
  tools: ExtensionRoleTool[];
  model: string;
  systemPrompt: string;
};

const EMPTY_DRAFT: AgentDraft = {
  name: '',
  description: '',
  tools: [],
  model: '',
  systemPrompt: '',
};

function AgentForm({
  busy,
  onCancel,
  onSave,
}: {
  busy: boolean;
  onCancel: () => void;
  onSave: (input: {
    name: string;
    description: string;
    tools: ExtensionRoleTool[];
    model: string | null;
    systemPrompt: string;
  }) => void;
}) {
  const { t } = useTranslation('settings');
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  return (
    <form
      className="settings-extension-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          name: draft.name.trim(),
          description: draft.description.trim(),
          tools: draft.tools,
          model: draft.model.trim() || null,
          systemPrompt: draft.systemPrompt,
        });
      }}
    >
      <label className="settings-extension-field">
        <span>{t('extensions.agentName')}</span>
        <Input
          value={draft.name}
          disabled={busy}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          required
        />
      </label>
      <label className="settings-extension-field">
        <span>{t('extensions.agentDescription')}</span>
        <Input
          value={draft.description}
          disabled={busy}
          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          required
        />
      </label>
      <fieldset className="settings-extension-fieldset" disabled={busy}>
        <legend>{t('extensions.agentTools')}</legend>
        <div className="settings-extension-tool-list">
          {ROLE_TOOLS.map((tool) => {
            const checked = draft.tools.includes(tool);
            return (
              <label key={tool} className="settings-extension-tool">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const tools = checked
                      ? draft.tools.filter((value) => value !== tool)
                      : [...draft.tools, tool];
                    setDraft({ ...draft, tools });
                  }}
                />
                <span>{tool}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <label className="settings-extension-field">
        <span>{t('extensions.agentModelOptional')}</span>
        <Input
          value={draft.model}
          disabled={busy}
          onChange={(event) => setDraft({ ...draft, model: event.target.value })}
        />
      </label>
      <label className="settings-extension-field">
        <span>{t('extensions.agentSystemPrompt')}</span>
        <Textarea
          value={draft.systemPrompt}
          disabled={busy}
          rows={6}
          onChange={(event) => setDraft({ ...draft, systemPrompt: event.target.value })}
          required
        />
      </label>
      <div className="settings-extension-form-actions">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onCancel}>
          {t('extensions.cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {t('extensions.saveSubagent')}
        </Button>
      </div>
    </form>
  );
}

/**
 * Subagent catalog: the service's system agents, then the markdown specialists (`~/.atd/agents`);
 * the add form opens from the tab menu. Rows share the skill row anatomy (icon ring, name, a
 * description line naming system sources, the enable switch and More); the search matches and
 * marks the name and that line. Turning an agent off applies from the next run.
 */
export function ExtensionAgentsGroup({
  rows,
  query,
  loading,
  empty,
  connected,
  busy,
  adding,
  formKey,
  onClose,
  onSave,
  onEnabled,
}: {
  rows: ExtensionAgentRow[];
  query: string;
  loading: boolean;
  empty: string;
  connected: boolean;
  busy: boolean;
  adding: boolean;
  formKey: number;
  onClose: () => void;
  onSave: (input: {
    name: string;
    description: string;
    tools: ExtensionRoleTool[];
    model: string | null;
    systemPrompt: string;
  }) => Promise<boolean>;
  onEnabled: (name: string, enabled: boolean) => void;
}) {
  const { t } = useTranslation('settings');
  // The name stays while the dialog closes; the row is read live so a toggle shows in it.
  const [detail, setDetail] = useState<{ name: string; open: boolean } | null>(null);
  const detailRow = detail ? rows.find((row) => row.name === detail.name) : undefined;
  const form =
    adding && connected ? (
      <AgentForm
        key={formKey}
        busy={busy}
        onCancel={onClose}
        onSave={(input) => {
          void onSave(input).then((ok) => {
            if (ok) onClose();
          });
        }}
      />
    ) : null;
  const shown = rows.flatMap((row) => {
    const description = [row.description, row.system ? t('extensions.sourceSystem') : '']
      .filter(Boolean)
      .join(' · ');
    const match = matchFields(query, { name: row.name, description });
    return match || !query.trim() ? [{ row, description, match }] : [];
  });

  return (
    <>
      {form}
      <ExtensionGroup
        title={t('extensions.tabSubagents')}
        empty={empty}
        loading={loading}
        hasRows={shown.length > 0}
        showTitle={false}
        emptyIcon={<Bot />}
      >
        {shown.map(({ row, description, match }) => (
          <ExtensionRow
            key={row.name}
            name={row.name}
            onDetails={() => setDetail({ name: row.name, open: true })}
          >
            <ItemMedia variant="icon">
              <Bot />
            </ItemMedia>
            <ItemContent>
              <ItemTitle title={row.name}>
                <HighlightedText text={row.name} ranges={match?.ranges.name} />
              </ItemTitle>
              {description ? (
                <ItemDescription title={description}>
                  <HighlightedText text={description} ranges={match?.ranges.description} />
                </ItemDescription>
              ) : null}
            </ItemContent>
            <ExtensionRowActions
              name={row.name}
              enabled={row.enabled}
              disabled={!connected}
              onEnabledChange={(enabled) => onEnabled(row.name, enabled)}
              onDetails={() => setDetail({ name: row.name, open: true })}
            />
          </ExtensionRow>
        ))}
      </ExtensionGroup>
      {detailRow ? (
        <AgentDetailDialog
          row={detailRow}
          open={detail?.open ?? false}
          onOpenChange={(open) => setDetail({ name: detailRow.name, open })}
        />
      ) : null}
    </>
  );
}
