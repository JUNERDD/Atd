import { useCallback, useEffect } from 'react';
import { useRecordHotkeys } from 'react-hotkeys-hook';
import { isComposingKey } from '@atd/ui/lib/ime';

/** The existing recorder owns key collection; this adapter handles native focus and IME boundaries. */
export function useShortcutCapture() {
  const [keys, recorder] = useRecordHotkeys(false, ['tab', 'escape']);
  const { stop, resetKeys, isRecording } = recorder;
  const cancel = useCallback(() => {
    stop();
    resetKeys();
  }, [stop, resetKeys]);
  useEffect(() => {
    if (!isRecording) return;
    function guard(event: KeyboardEvent) {
      if (event.key === 'Tab' || event.key === 'Escape') {
        cancel();
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      } else if (event.repeat || isComposingKey(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }
    window.addEventListener('keydown', guard, true);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', guard, true);
      window.removeEventListener('blur', cancel);
    };
  }, [cancel, isRecording]);
  return { keys, ...recorder, cancel };
}
