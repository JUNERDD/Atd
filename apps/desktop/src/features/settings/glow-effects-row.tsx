import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_GLOW_EFFECTS, type SettingsSnapshot } from '../../client/settings-contract';
import { SettingsSwitchRow } from './settings-switch-row';
import { useSettingsSectionExit } from './settings-navigation';

/**
 * General › Appearance: whether the app's decorative glows and running-text shimmer show, in the
 * panel and the shell's surfaces alike. It saves on its own; leaving the section clears its error.
 */
export function GlowEffectsRow({ snapshot }: { snapshot: SettingsSnapshot | null }) {
  const { t } = useTranslation('settings');
  const save = window.desktop?.settings.setGlowEffects;
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
          : t('shortcuts.glowEffects.saveFailed'),
      );
    }
    setPending(false);
  }

  return (
    <SettingsSwitchRow
      id="settings-glow-effects"
      anchor="settings-glow-effects"
      title={t('shortcuts.glowEffects.title')}
      description={t('shortcuts.glowEffects.description')}
      checked={snapshot?.glowEffects ?? DEFAULT_GLOW_EFFECTS}
      disabled={!snapshot || !save}
      pending={pending}
      note={error}
      onCheckedChange={(value) => void change(value)}
    />
  );
}
