import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { recordedKeysToAccelerator } from '../../lib/shortcuts';
import { useShortcutCapture } from '../settings/use-shortcut-capture';

/**
 * Records a command shortcut, for the editor's field and the list row alike: recording stops at
 * the first key pressed with its modifiers, hands a valid accelerator to `onRecorded`, and keeps
 * an invalid one (no modifier besides Shift) as `error` until the next recording starts.
 */
export function useCommandShortcutCapture(onRecorded: (shortcut: string) => void) {
  const { t } = useTranslation('commands');
  const capture = useShortcutCapture();
  const platform = window.desktop?.platform ?? 'web';
  const { keys, isRecording, stop, resetKeys } = capture;
  const hasKey = [...keys].some((key) => !['meta', 'ctrl', 'alt', 'shift'].includes(key));
  const shortcut = recordedKeysToAccelerator(keys, platform);
  const invalid =
    !shortcut ||
    !shortcut.includes('+') ||
    (shortcut.startsWith('Shift+') && shortcut.split('+').length === 2);
  useEffect(() => {
    if (!isRecording || !hasKey) return;
    stop();
    if (invalid || !shortcut) return;
    onRecorded(shortcut);
    resetKeys();
  }, [hasKey, invalid, shortcut, isRecording, stop, resetKeys, onRecorded]);
  return { capture, platform, error: hasKey && invalid ? t('shortcut.error') : '' };
}
