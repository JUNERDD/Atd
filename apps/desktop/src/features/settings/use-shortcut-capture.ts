import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useHotkeyRecorder, type ReactHotkeyRecorder } from '@tanstack/react-hotkeys';
import { recordedHotkeyToAccelerator } from '../../lib/shortcuts';
import { modifierDoubleTap } from './modifier-double-tap';
import { useRecordingBoundaries } from './use-recording-boundaries';
import { useRecordingSession } from './use-recording-session';

/**
 * Records one physical chord with the modifiers held when its key goes down. The library owns
 * chord capture; this adapter keeps the native grammar, focus/IME boundaries and modifier taps.
 * Completion delivers null for a key the native grammar cannot express, so callers can reject it.
 */
export function useShortcutCapture({
  doubleTap: allowDoubleTap = false,
  onRecorded,
  onStart,
  onCancel,
}: {
  doubleTap?: boolean;
  onRecorded: (shortcut: string | null) => void;
  onStart?: () => void;
  onCancel?: () => void;
}) {
  const platform = window.desktop?.platform ?? 'web';
  const callbacks = useRef({ onRecorded, onStart, onCancel });
  const controls = useRef<ReactHotkeyRecorder | null>(null);
  const recorder = useHotkeyRecorder({
    maxSteps: 1,
    recordBy: 'code',
    platform: platform === 'darwin' ? 'mac' : 'windows',
    ignoreInputs: false,
    onRecord: (hotkey) => complete(recordedHotkeyToAccelerator(hotkey, platform)),
    onReject: () => complete(null),
    onCancel: () => cancel(),
  });
  useLayoutEffect(() => {
    callbacks.current = { onRecorded, onStart, onCancel };
    controls.current = recorder;
  }, [onRecorded, onStart, onCancel, recorder]);
  const { start, stop, cancel, isActive, isPending, preparing } = useRecordingSession({
    start: () => {
      callbacks.current.onStart?.();
      controls.current?.startRecording();
    },
    stop: () => controls.current?.stopRecording(),
    onCancel: () => callbacks.current.onCancel?.(),
  });
  const complete = useCallback(
    (shortcut: string | null) => {
      if (!isActive()) return;
      stop();
      callbacks.current.onRecorded(shortcut);
    },
    [isActive, stop],
  );
  const { isRecording } = recorder;
  useRecordingBoundaries(isRecording || preparing, cancel, isPending);

  useEffect(() => {
    if (!isRecording) return;
    function deletionKey(event: KeyboardEvent) {
      if (!isActive()) return;
      if (
        (event.code === 'Backspace' || event.code === 'Delete') &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        // The library treats these as Clear; the app allows either as Send or New line.
        event.preventDefault();
        event.stopImmediatePropagation();
        complete(event.code);
      }
    }
    window.addEventListener('keydown', deletionKey, true);
    return () => window.removeEventListener('keydown', deletionKey, true);
  }, [complete, isActive, isRecording]);
  useEffect(() => {
    if (!isRecording || !allowDoubleTap) return;
    const follow = modifierDoubleTap();
    function tap(event: KeyboardEvent) {
      if (!isActive()) return;
      const modifier = follow(event);
      if (modifier) complete(`DoubleTap+${modifier}`);
    }
    window.addEventListener('keydown', tap, true);
    window.addEventListener('keyup', tap, true);
    return () => {
      window.removeEventListener('keydown', tap, true);
      window.removeEventListener('keyup', tap, true);
    };
  }, [allowDoubleTap, complete, isActive, isRecording]);
  return { isRecording, start, stop, cancel };
}
