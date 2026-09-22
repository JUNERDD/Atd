import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Input } from '@ai/ui/components/input';

type SkillInstallSourceKind = 'local' | 'npm' | 'git';

type SkillInstallDraft = {
  sourceKind: SkillInstallSourceKind;
  source: string;
  name: string;
};

const EMPTY_DRAFT: SkillInstallDraft = {
  sourceKind: 'local',
  source: '',
  name: '',
};

/** Installs a skill via skillsInstall; does not write ~/.atd/skills itself. */
export function SkillInstallForm({
  busy,
  onCancel,
  onSave,
}: {
  busy: boolean;
  onCancel: () => void;
  onSave: (input: { source: string; sourceKind: 'local' | 'npm' | 'git'; name?: string }) => void;
}) {
  const { t } = useTranslation('settings');
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  return (
    <form
      className="settings-extension-form"
      onSubmit={(event) => {
        event.preventDefault();
        const name = draft.name.trim();
        onSave({
          source: draft.source.trim(),
          sourceKind: draft.sourceKind,
          ...(name ? { name } : {}),
        });
      }}
    >
      <label className="settings-extension-field">
        <span>{t('extensions.skillSourceKind')}</span>
        <select
          className="settings-extension-select"
          value={draft.sourceKind}
          disabled={busy}
          onChange={(event) =>
            setDraft({ ...draft, sourceKind: event.target.value as SkillInstallSourceKind })
          }
        >
          <option value="local">{t('extensions.sourceLocal')}</option>
          <option value="npm">{t('extensions.sourceNpm')}</option>
          <option value="git">{t('extensions.sourceGit')}</option>
        </select>
      </label>
      <label className="settings-extension-field">
        <span>{t('extensions.skillSource')}</span>
        <Input
          value={draft.source}
          disabled={busy}
          onChange={(event) => setDraft({ ...draft, source: event.target.value })}
          required
        />
      </label>
      <label className="settings-extension-field">
        <span>{t('extensions.skillNameOptional')}</span>
        <Input
          value={draft.name}
          disabled={busy}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
      </label>
      <div className="settings-extension-form-actions">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onCancel}>
          {t('extensions.cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {t('extensions.installSkill')}
        </Button>
      </div>
    </form>
  );
}
