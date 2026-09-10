import { useCallback, useEffect, useState } from 'react';
import { useRecordHotkeys } from 'react-hotkeys-hook';
import {
  DEFAULT_SHORTCUTS,
  type SettingsSnapshot,
  type ShortcutAction,
  type ShortcutBindings,
} from '../../../electron/settings-contract';
import { recordedKeysToAccelerator } from '../../lib/shortcuts';

const RECORDING_CONTROLS = ['tab', 'escape'];
const MODIFIER_KEYS = new Set(['meta', 'ctrl', 'alt', 'shift']);

function shortcutError(action: ShortcutAction, shortcut: string | null): string {
  if (!shortcut) return 'This key combination is not supported. Try another shortcut.';
  if (
    ['togglePanel', 'newConversation', 'openSettings'].includes(action) &&
    !shortcut
      .split('+')
      .some((key) => ['CommandOrControl', 'Control', 'Alt', 'Super'].includes(key))
  ) {
    return 'Include a modifier such as Command, Control, or Alt.';
  }
  return '';
}

export function useShortcutSettings(snapshot: SettingsSnapshot | null) {
  const desktop = window.desktop;
  const bridge = desktop?.settings;
  const platform = desktop?.platform ?? 'web';
  const bindings: ShortcutBindings = snapshot?.shortcuts ?? DEFAULT_SHORTCUTS;
  const pinned = snapshot?.pinned ?? false;
  const [keys, { start, stop, resetKeys, isRecording }] = useRecordHotkeys(
    false,
    RECORDING_CONTROLS,
  );
  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(null);
  const [mutationPending, setPending] = useState<'restore' | 'pin' | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const unavailable = !snapshot || !bridge;
  const hasRecordedKey = [...keys].some((key) => !MODIFIER_KEYS.has(key));
  const capturedShortcut = recordedKeysToAccelerator(keys, platform);
  const captureError =
    recordingAction && hasRecordedKey ? shortcutError(recordingAction, capturedShortcut) : '';
  const capturePending = recordingAction !== null && hasRecordedKey && !captureError;
  const pending = capturePending ? 'shortcut' : mutationPending;
  const recording = isRecording && !hasRecordedKey ? recordingAction : null;

  const cancelRecording = useCallback(() => {
    stop();
    resetKeys();
    setRecordingAction(null);
    setError('');
    setStatus('Recording canceled.');
  }, [resetKeys, stop]);

  useEffect(() => {
    if (!isRecording || !recordingAction || !hasRecordedKey) return;
    stop();
    if (!bridge || captureError || !capturedShortcut) return;
    void bridge.saveShortcuts({ ...bindings, [recordingAction]: capturedShortcut }).then(
      () => {
        resetKeys();
        setRecordingAction(null);
        setStatus('Shortcut saved.');
      },
      (reason: unknown) => {
        resetKeys();
        setRecordingAction(null);
        setError(reason instanceof Error ? reason.message : 'The shortcut could not be saved.');
        setStatus('');
      },
    );
  }, [
    bindings,
    bridge,
    captureError,
    capturedShortcut,
    hasRecordedKey,
    isRecording,
    recordingAction,
    resetKeys,
    stop,
  ]);

  useEffect(() => {
    if (!isRecording) return;
    function handleRecordingControl(event: KeyboardEvent) {
      if (event.key === 'Tab' || event.key === 'Escape') {
        cancelRecording();
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        return;
      }
      // The recorder has no event filter; keep composition and held-key repeats out of its Set.
      if (event.repeat || event.isComposing || event.keyCode === 229) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }
    window.addEventListener('keydown', handleRecordingControl, true);
    window.addEventListener('blur', cancelRecording);
    return () => {
      window.removeEventListener('keydown', handleRecordingControl, true);
      window.removeEventListener('blur', cancelRecording);
    };
  }, [cancelRecording, isRecording]);

  function startRecording(action: ShortcutAction) {
    if (unavailable || pending) return;
    setRecordingAction(action);
    start();
    setError('');
    setStatus('Press a shortcut. Escape cancels; Tab moves to the next control.');
  }

  async function restoreDefaults() {
    if (!bridge || unavailable || pending || recording) return;
    resetKeys();
    setRecordingAction(null);
    setPending('restore');
    setError('');
    setStatus('');
    try {
      await bridge.restoreShortcuts();
      setStatus('Default shortcuts restored.');
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Default shortcuts could not be restored.',
      );
    } finally {
      setPending(null);
    }
  }

  async function changePinned(value: boolean) {
    if (!desktop || unavailable || pending || recording) return;
    resetKeys();
    setRecordingAction(null);
    setPending('pin');
    setError('');
    setStatus('');
    try {
      await desktop.setPinned(value);
      setStatus('Window preference saved.');
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'The window preference could not be saved.',
      );
    } finally {
      setPending(null);
    }
  }

  return {
    bindings,
    pinned,
    recording,
    pending,
    error: captureError || error,
    status: capturePending ? 'Saving shortcut…' : status,
    unavailable,
    platform,
    startRecording,
    cancelRecording,
    restoreDefaults,
    changePinned,
  };
}
