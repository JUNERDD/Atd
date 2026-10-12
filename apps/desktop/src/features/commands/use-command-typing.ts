import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { showErrorToast } from '../../components/toast-store';
import {
  DEFAULT_COMMAND_TYPING,
  DEFAULT_COMMAND_TYPING_ANIMATION,
  type SettingsBridge,
  type SettingsSnapshot,
} from '../../client/settings-contract';
import { showSettingsSnapshot } from '../settings/use-settings';

/** The typing settings the Commands page's footer switches, each with its default and its save. */
const TYPING_SETTINGS = {
  commandTyping: {
    fallback: DEFAULT_COMMAND_TYPING,
    save: (bridge: SettingsBridge, value: boolean) => bridge.saveCommandTyping(value),
    error: 'typing.errors.save',
  },
  commandTypingAnimation: {
    fallback: DEFAULT_COMMAND_TYPING_ANIMATION,
    save: (bridge: SettingsBridge, value: boolean) => bridge.saveCommandTypingAnimation(value),
    error: 'typingAnimation.errors.save',
  },
} as const;

export type CommandTypingSetting = keyof typeof TYPING_SETTINGS;

/**
 * One typing switch on the Commands page (`setting`): the typing effect itself or its animation. A
 * flip shows at once and saves through the service, whose answer replaces the cached snapshot;
 * while it saves, the switch ignores input. A failed save falls back to the stored value and says
 * so in a toast.
 */
export function useCommandTyping(snapshot: SettingsSnapshot | null, setting: CommandTypingSetting) {
  const { t } = useTranslation('commands');
  const bridge = window.desktop?.settings;
  const { fallback, save, error } = TYPING_SETTINGS[setting];
  // The flip the service has not confirmed yet; null once the stored value is it.
  const [choice, setChoice] = useState<boolean | null>(null);
  const unavailable = !bridge || !snapshot;
  const value = choice ?? snapshot?.[setting] ?? fallback;

  async function change(next: boolean) {
    if (!bridge || unavailable || choice !== null || next === value) return;
    setChoice(next);
    try {
      showSettingsSnapshot(await save(bridge, next));
    } catch {
      showErrorToast(t(error));
    } finally {
      setChoice(null);
    }
  }

  return { value, unavailable, pending: choice !== null, change };
}
