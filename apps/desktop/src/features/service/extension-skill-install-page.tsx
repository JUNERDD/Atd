import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Input } from '@ai/ui/components/input';
import { Label } from '@ai/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ai/ui/components/select';
import { FieldHint } from '../../components/field-hint';
import { ExtensionPage } from './extension-page';

type SkillInstallSourceKind = 'local' | 'npm' | 'git';

/** What `skillsInstall` takes: an existing skill folder or an already installed package. */
export type SkillInstallInput = {
  source: string;
  sourceKind: SkillInstallSourceKind;
  name?: string;
};

const SOURCE_KINDS: readonly SkillInstallSourceKind[] = ['local', 'npm', 'git'];

function isSourceKind(value: string): value is SkillInstallSourceKind {
  return value === 'local' || value === 'npm' || value === 'git';
}

/**
 * The Add skill page: installs a skill that already exists, from a local folder or a package the
 * service already manages; it never writes `~/.atd/skills` itself. Create with AI is the other
 * route, where a panel session authors a brand-new skill with the create-skill skill. The root
 * returns to the list after a successful install, and a failed one keeps the draft here (the
 * mutation has already shown the error).
 */
export function SkillInstallPage({
  connected,
  busy,
  onBack,
  onInstall,
  onStartAi,
}: {
  connected: boolean;
  busy: boolean;
  onBack: () => void;
  onInstall: (input: SkillInstallInput) => Promise<boolean>;
  onStartAi: () => void;
}) {
  const { t } = useTranslation('settings');
  const [sourceKind, setSourceKind] = useState<SkillInstallSourceKind>('local');
  const [source, setSource] = useState('');
  const [name, setName] = useState('');
  const [missingSource, setMissingSource] = useState(false);
  const locked = busy || !connected;
  function submit() {
    const trimmed = source.trim();
    if (!trimmed) {
      setMissingSource(true);
      document.getElementById('skill-install-source')?.focus();
      return;
    }
    const skillName = name.trim();
    void onInstall({ source: trimmed, sourceKind, ...(skillName ? { name: skillName } : {}) });
  }
  return (
    <ExtensionPage
      label={t('extensions.addSkill')}
      title={t('extensions.addSkill')}
      description={t('extensions.skillPage.addDescription')}
      backLabel={t('extensions.skillPage.back')}
      onBack={onBack}
      ai={{ label: t('extensions.createWithAi'), disabled: locked, onClick: onStartAi }}
      actions={
        <>
          <Button type="button" variant="outline" onClick={onBack}>
            {t('extensions.cancel')}
          </Button>
          {/* Outside the form in the footer; `form` still makes it the form's default button,
              so Enter in a field submits. */}
          <Button type="submit" form="skill-install-form" disabled={locked}>
            {t('extensions.installSkill')}
          </Button>
        </>
      }
    >
      <form
        id="skill-install-form"
        className="editor-fields"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!locked) submit();
        }}
      >
        <div className="field-columns aligned-fields">
          <div className="settings-field">
            <Label htmlFor="skill-install-kind">{t('extensions.skillSourceKind')}</Label>
            <Select
              value={sourceKind}
              disabled={locked}
              onValueChange={(value) => {
                if (isSourceKind(value)) setSourceKind(value);
              }}
            >
              <SelectTrigger id="skill-install-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {t(`extensions.skillPage.kind.${kind}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="settings-field">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="skill-install-name">{t('extensions.skillNameOptional')}</Label>
              <FieldHint text={t('extensions.skillPage.nameHint')} />
            </div>
            <Input
              id="skill-install-name"
              value={name}
              disabled={locked}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        </div>
        <div className="settings-field">
          <Label htmlFor="skill-install-source">{t('extensions.skillSource')}</Label>
          <Input
            id="skill-install-source"
            value={source}
            disabled={locked}
            autoComplete="off"
            spellCheck={false}
            placeholder={t(`extensions.skillPage.sourcePlaceholder.${sourceKind}`)}
            aria-invalid={missingSource}
            aria-describedby={
              missingSource
                ? 'skill-install-source-error skill-install-source-hint'
                : 'skill-install-source-hint'
            }
            onChange={(event) => {
              setSource(event.target.value);
              if (event.target.value.trim()) setMissingSource(false);
            }}
          />
          {missingSource ? (
            <p id="skill-install-source-error" role="alert" className="text-xs text-destructive">
              {t('extensions.skillPage.sourceRequired')}
            </p>
          ) : null}
          <p id="skill-install-source-hint" className="settings-field-note">
            {t(`extensions.skillPage.sourceHint.${sourceKind}`)}
          </p>
        </div>
      </form>
    </ExtensionPage>
  );
}
