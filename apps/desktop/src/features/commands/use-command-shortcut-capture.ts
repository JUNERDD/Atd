import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { recordedKeysToAccelerator } from '../../lib/shortcuts';
import { useShortcutCapture } from '../settings/use-shortcut-capture';

/**
 * Records a command shortcut, for the editor's field and the list row alike: recording stops at
 * the first key pressed with its modifiers, or on macOS at a lone modifier's double-tap, hands a
 * valid accelerator to `onRecorded`, and keeps an invalid one (no modifier besides Shift) as
 * `error` until the next recording starts.
 */
export function useCommandShortcutCapture(onRecorded: (shortcut: string) => void) {
  const { t } = useTranslation('commands');
  const platform = window.desktop?.platform ?? 'web';
  // The shell registers command shortcuts globally, so on macOS one may be a double-tap.
  const capture = useShortcutCapture({ doubleTap: platform === 'darwin' });
  const { keys, isRecording, stop, resetKeys, doubleTap } = capture;
  const hasKey =
    doubleTap !== null || [...keys].some((key) => !['meta', 'ctrl', 'alt', 'shift'].includes(key));
  const shortcut = doubleTap ?? recordedKeysToAccelerator(keys, platform);
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
