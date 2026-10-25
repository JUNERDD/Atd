import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShortcutCapture } from '../settings/use-shortcut-capture';

/**
 * Records a command shortcut, for the editor's field and the list row alike. A completed chord
 * or modifier double-tap goes to `onRecorded`; an invalid attempt stays as an error until the
 * next recording starts or the field loses focus.
 */
export function useCommandShortcutCapture(onRecorded: (shortcut: string) => void) {
  const { t } = useTranslation('commands');
  const platform = window.desktop?.platform ?? 'web';
  const [invalid, setInvalid] = useState(false);
  const capture = useShortcutCapture({
    // The shell registers command shortcuts globally, so on macOS one may be a double-tap.
    doubleTap: platform === 'darwin',
    onStart: () => setInvalid(false),
    onCancel: () => setInvalid(false),
    onRecorded: (shortcut) => {
      if (
        !shortcut ||
        !shortcut.includes('+') ||
        (shortcut.startsWith('Shift+') && shortcut.split('+').length === 2)
      ) {
        setInvalid(true);
        return;
      }
      onRecorded(shortcut);
    },
  });
  return { capture, platform, error: invalid ? t('shortcut.error') : '' };
}
