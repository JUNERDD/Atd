import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { showErrorToast } from '../../components/toast-store';
import { DEFAULT_COMMAND_TYPING, type SettingsSnapshot } from '../../client/settings-contract';
import { showSettingsSnapshot } from '../settings/use-settings';

/**
 * The typing switch on the Commands page. A flip shows at once and saves through the service, whose
 * answer replaces the cached snapshot; while it saves, the switch ignores input. A failed save
 * falls back to the stored value and says so in a toast.
 */
export function useCommandTyping(snapshot: SettingsSnapshot | null) {
  const { t } = useTranslation('commands');
  const bridge = window.desktop?.settings;
  // The flip the service has not confirmed yet; null once the stored value is it.
  const [choice, setChoice] = useState<boolean | null>(null);
  const unavailable = !bridge || !snapshot;
  const value = choice ?? snapshot?.commandTyping ?? DEFAULT_COMMAND_TYPING;

  async function change(next: boolean) {
    if (!bridge || unavailable || choice !== null || next === value) return;
    setChoice(next);
    try {
      showSettingsSnapshot(await bridge.saveCommandTyping(next));
    } catch {
      showErrorToast(t('typing.errors.save'));
    } finally {
      setChoice(null);
    }
  }

  return { value, unavailable, pending: choice !== null, change };
}
