import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_SUMMARY_TITLES, type SettingsSnapshot } from '../../client/settings-contract';
import { SettingsSwitchRow } from './settings-switch-row';
import { useSettingsSectionExit } from './settings-navigation';

/** Saves the naming preference for future conversations independently of other agent settings. */
export function SummaryTitlesRow({ snapshot }: { snapshot: SettingsSnapshot | null }) {
  const { t } = useTranslation('settings');
  const save = window.desktop?.settings.setSummaryTitles;
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
          : t('shortcuts.summaryTitles.saveFailed'),
      );
    }
    setPending(false);
  }

  return (
    <SettingsSwitchRow
      id="settings-summary-titles"
      anchor="settings-summary-titles"
      title={t('shortcuts.summaryTitles.title')}
      description={t('shortcuts.summaryTitles.description')}
      checked={snapshot?.summaryTitles ?? DEFAULT_SUMMARY_TITLES}
      disabled={!snapshot || !save}
      pending={pending}
      note={error}
      onCheckedChange={(value) => void change(value)}
    />
  );
}
