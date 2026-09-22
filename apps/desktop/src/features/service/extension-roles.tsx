import { useState } from 'react';
import { Bot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Input } from '@ai/ui/components/input';
import { Textarea } from '@ai/ui/components/textarea';
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@ai/ui/components/item';
import { ExtensionGroup } from './extension-group';
import { ROLE_TOOLS, type ExtensionRoleRow, type ExtensionRoleTool } from './use-service';

type RoleDraft = {
  id: string;
  title: string;
  tools: ExtensionRoleTool[];
  skillsText: string;
};

const EMPTY_DRAFT: RoleDraft = { id: '', title: '', tools: [], skillsText: '' };

function parseSkillLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function RoleForm({
  draft,
  editing,
  busy,
  error,
  onChange,
  onCancel,
  onSave,
}: {
  draft: RoleDraft;
  editing: boolean;
  busy: boolean;
  error: string | null;
  onChange: (next: RoleDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <form
      className="settings-extension-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <label className="settings-extension-field">
        <span>{t('extensions.roleId')}</span>
        <Input
          value={draft.id}
          disabled={editing || busy}
          onChange={(event) => onChange({ ...draft, id: event.target.value })}
          required
        />
      </label>
      <label className="settings-extension-field">
        <span>{t('extensions.roleTitle')}</span>
        <Input
          value={draft.title}
          disabled={busy}
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
          required
        />
      </label>
      <fieldset className="settings-extension-fieldset" disabled={busy}>
        <legend>{t('extensions.allowedTools')}</legend>
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
                    onChange({ ...draft, tools });
                  }}
                />
                <span>{tool}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <label className="settings-extension-field">
        <span>{t('extensions.allowedSkills')}</span>
        <Textarea
          value={draft.skillsText}
          disabled={busy}
          rows={4}
          placeholder={t('extensions.allowedSkillsHint')}
          onChange={(event) => onChange({ ...draft, skillsText: event.target.value })}
        />
      </label>
      {error ? <p className="settings-extension-form-error">{error}</p> : null}
      <div className="settings-extension-form-actions">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onCancel}>
          {t('extensions.cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {t('extensions.saveRole')}
        </Button>
      </div>
    </form>
  );
}

/** Roles catalog with add/edit allow-list form when connected. */
export function ExtensionRolesGroup({
  rows,
  loading,
  empty,
  connected,
  busy,
  onSave,
}: {
  rows: ExtensionRoleRow[];
  loading: boolean;
  empty: string;
  connected: boolean;
  busy: boolean;
  onSave: (input: {
    id: string;
    title: string;
    allows: { tools: ExtensionRoleTool[]; skills: string[] };
  }) => Promise<boolean>;
}) {
  const { t } = useTranslation('settings');
  const [mode, setMode] = useState<'closed' | 'add' | 'edit'>('closed');
  const [draft, setDraft] = useState<RoleDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);

  const openAdd = () => {
    setDraft(EMPTY_DRAFT);
    setError(null);
    setMode('add');
  };
  const openEdit = (row: ExtensionRoleRow) => {
    setDraft({
      id: row.id,
      title: row.title,
      tools: [...row.allows.tools],
      skillsText: row.allows.skills.join('\n'),
    });
    setError(null);
    setMode('edit');
  };
  const closeForm = () => {
    setMode('closed');
    setError(null);
  };
  const save = async () => {
    const skills = parseSkillLines(draft.skillsText);
    if (skills.length > 128) {
      setError(t('extensions.roleSkillsLimit'));
      return;
    }
    setError(null);
    const ok = await onSave({
      id: draft.id.trim(),
      title: draft.title.trim(),
      allows: { tools: draft.tools, skills },
    });
    if (ok) closeForm();
  };

  const addButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={!connected || busy}
      onClick={openAdd}
    >
      {t('extensions.addRole')}
    </Button>
  );

  return (
    <ExtensionGroup
      title={t('extensions.tabSubagents')}
      note={t('service.rolesNote')}
      empty={empty}
      loading={loading}
      hasRows={rows.length > 0}
      showTitle={false}
      emptyIcon={<Bot />}
      emptyAction={
        <>
          {addButton}
          {mode === 'add' ? (
            <RoleForm
              draft={draft}
              editing={false}
              busy={busy}
              error={error}
              onChange={setDraft}
              onCancel={closeForm}
              onSave={() => void save()}
            />
          ) : null}
        </>
      }
      footer={
        <div className="settings-extension-group-action">
          {addButton}
          {mode === 'add' ? (
            <RoleForm
              draft={draft}
              editing={false}
              busy={busy}
              error={error}
              onChange={setDraft}
              onCancel={closeForm}
              onSave={() => void save()}
            />
          ) : null}
        </div>
      }
    >
      {rows.map((row) => (
        <Item asChild key={row.id} size="xs">
          <li>
            <ItemContent>
              <ItemTitle title={row.title}>{row.title}</ItemTitle>
              {row.id ? <ItemDescription title={row.id}>{row.id}</ItemDescription> : null}
              {mode === 'edit' && draft.id === row.id ? (
                <RoleForm
                  draft={draft}
                  editing
                  busy={busy}
                  error={error}
                  onChange={setDraft}
                  onCancel={closeForm}
                  onSave={() => void save()}
                />
              ) : null}
            </ItemContent>
            {connected && !(mode === 'edit' && draft.id === row.id) ? (
              <ItemActions>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => openEdit(row)}
                >
                  {t('extensions.editRole')}
                </Button>
              </ItemActions>
            ) : null}
          </li>
        </Item>
      ))}
    </ExtensionGroup>
  );
}
