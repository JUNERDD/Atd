import { useEffect } from 'react';
import { SELECTION_TOOLBAR_KEYS, type SelectionToolbarKey } from '../../client/settings-contract';
import { useShortcutCapture } from './use-shortcut-capture';

/** The recorder's modifier tokens (`useRecordHotkeys`) that name an activation key. */
const TOKEN_KEYS: Readonly<Record<string, SelectionToolbarKey>> = {
  alt: 'option',
  meta: 'command',
  shift: 'shift',
};

const isKeyToken = (token: string) => Object.hasOwn(TOKEN_KEYS, token);

/** A finished recording: the combination in contract order, or a key it cannot hold. */
export type ActivationCapture = { keys: SelectionToolbarKey[] } | { invalid: true };

/**
 * Records the selection toolbar's activation key combination with the shared recorder
 * (`useShortcutCapture`, which also cancels on Tab, Escape and window blur). Unlike an app
 * shortcut it has no final key: the recording ends once every key is released, with each key that
 * was down meanwhile. Any key but Option, Command and Shift ends it at once as invalid: a letter
 * would type while held, and Control turns a click into a secondary click.
 */
export function useActivationKeysCapture(onCapture: (capture: ActivationCapture) => void) {
  const { keys, start, stop, resetKeys, isRecording, cancel } = useShortcutCapture();
  useEffect(() => {
    if (!isRecording || keys.size === 0) return;
    const pressed = [...keys];
    const finish = () => {
      stop();
      resetKeys();
      onCapture(
        pressed.every(isKeyToken)
          ? {
              keys: SELECTION_TOOLBAR_KEYS.filter((key) =>
                pressed.some((t) => TOKEN_KEYS[t] === key),
              ),
            }
          : { invalid: true },
      );
    };
    if (!pressed.every(isKeyToken)) {
      finish();
      return;
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (!event.altKey && !event.metaKey && !event.shiftKey && !event.ctrlKey) finish();
    };
    window.addEventListener('keyup', onKeyUp, true);
    return () => window.removeEventListener('keyup', onKeyUp, true);
  }, [isRecording, keys, onCapture, resetKeys, stop]);
  return { recording: isRecording, start, cancel };
}
