import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_RESULT_MARKDOWN, type SettingsSnapshot } from '../../client/settings-contract';
import { SettingsSwitchRow } from './settings-switch-row';
import { useSettingsSectionExit } from './settings-navigation';

/**
 * General › Appearance: whether the shell's floating result cards (the command island's answers
 * and reviews, and the capture, recording and long screenshot results) render Markdown or show
 * plain text. It saves on its own; leaving the section clears its error.
 */
export function ResultMarkdownRow({ snapshot }: { snapshot: SettingsSnapshot | null }) {
  const { t } = useTranslation('settings');
  const save = window.desktop?.settings.setResultMarkdown;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  useSettingsSectionExit(() => setError(undefined));

  async function change(enabled: boolean) {
    if (!save || pending) return;
    setError(undefined);
    setPending(true);
    try {
      await save(enabled);
    } catch (reason) {
      setError(
        reason instanceof Error && reason.message
          ? reason.message
          : t('shortcuts.resultMarkdown.saveFailed'),
      );
    }
    setPending(false);
  }

  return (
    <SettingsSwitchRow
      id="settings-result-markdown"
      anchor="settings-result-markdown"
      title={t('shortcuts.resultMarkdown.title')}
      description={t('shortcuts.resultMarkdown.description')}
      checked={snapshot?.resultMarkdown ?? DEFAULT_RESULT_MARKDOWN}
      disabled={!snapshot || !save}
      pending={pending}
      note={error}
      onCheckedChange={(value) => void change(value)}
    />
  );
}
