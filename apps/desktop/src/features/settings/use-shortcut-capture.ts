import { useCallback, useEffect, useState } from 'react';
import { useRecordHotkeys } from 'react-hotkeys-hook';
import { isComposingKey } from '@atd/ui/lib/ime';
import { modifierDoubleTap } from './modifier-double-tap';

/**
 * The existing recorder owns key collection; this adapter handles native focus and IME boundaries.
 * With `doubleTap` (only for shortcuts the shell registers globally), two quick taps of one lone
 * modifier also record, as `doubleTap` (`DoubleTap+Command`); the keys stay as they were.
 */
export function useShortcutCapture({ doubleTap: allowDoubleTap = false } = {}) {
  const [keys, recorder] = useRecordHotkeys(false, ['tab', 'escape']);
  const { start: startRecorder, stop, resetKeys: resetRecorder, isRecording } = recorder;
  const [doubleTap, setDoubleTap] = useState<string | null>(null);
  const resetKeys = useCallback(() => {
    resetRecorder();
    setDoubleTap(null);
  }, [resetRecorder]);
  const start = useCallback(() => {
    setDoubleTap(null);
    startRecorder();
  }, [startRecorder]);
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
  useEffect(() => {
    if (!isRecording || !allowDoubleTap) return;
    const follow = modifierDoubleTap();
    function tap(event: KeyboardEvent) {
      const modifier = follow(event);
      if (modifier) setDoubleTap(`DoubleTap+${modifier}`);
    }
    window.addEventListener('keydown', tap, true);
    window.addEventListener('keyup', tap, true);
    return () => {
      window.removeEventListener('keydown', tap, true);
      window.removeEventListener('keyup', tap, true);
    };
  }, [allowDoubleTap, isRecording]);
  return { keys, ...recorder, start, resetKeys, cancel, doubleTap };
}
