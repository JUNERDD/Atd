import { useCallback, useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useShortcutCapture } from './use-shortcut-capture';
import { DEFAULT_SHORTCUTS } from '@ai/agent-contracts';
import {
  type SettingsSnapshot,
  type ShortcutAction,
  type ShortcutBindings,
} from '../../../electron/settings-contract';
import { recordedKeysToAccelerator } from '../../lib/shortcuts';
import { showErrorToast, showToast } from '../../components/toast-store';

const MODIFIER_KEYS = new Set(['meta', 'ctrl', 'alt', 'shift']);

function shortcutError(
  t: TFunction<'settings'>,
  action: ShortcutAction,
  shortcut: string | null,
): string {
  if (!shortcut) return t('shortcuts.errors.unsupportedCombination');
  if (
    ['togglePanel', 'newConversation', 'openSettings'].includes(action) &&
    !shortcut
      .split('+')
      .some((key) => ['CommandOrControl', 'Control', 'Alt', 'Super'].includes(key))
  ) {
    return t('shortcuts.errors.modifierRequired');
  }
  return '';
}

export function useShortcutSettings(snapshot: SettingsSnapshot | null) {
  const { t } = useTranslation('settings');
  const desktop = window.desktop;
  const bridge = desktop?.settings;
  const platform = desktop?.platform ?? 'web';
  const bindings: ShortcutBindings = snapshot?.shortcuts ?? DEFAULT_SHORTCUTS;
  const pinned = snapshot?.pinned ?? false;
  const { keys, start, stop, resetKeys, isRecording } = useShortcutCapture();
  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(null);
  const [mutationPending, setPending] = useState<'restore' | 'pin' | null>(null);
  const unavailable = !snapshot || !bridge;
  const hasRecordedKey = [...keys].some((key) => !MODIFIER_KEYS.has(key));
  const capturedShortcut = recordedKeysToAccelerator(keys, platform);
  const captureError =
    recordingAction && hasRecordedKey ? shortcutError(t, recordingAction, capturedShortcut) : '';
  const capturePending = recordingAction !== null && hasRecordedKey && !captureError;
  const pending = capturePending ? 'shortcut' : mutationPending;
  const recording = isRecording && !hasRecordedKey ? recordingAction : null;

  const cancelRecording = useCallback(() => {
    stop();
    resetKeys();
    setRecordingAction(null);
    showToast({ kind: 'info', text: t('shortcuts.status.recordingCanceled') });
  }, [resetKeys, stop, t]);

  useEffect(() => {
    if (!isRecording || !recordingAction || !hasRecordedKey) return;
    stop();
    // Stopping alone ends a rejected attempt: `recording` and `pending` derive from the stopped
    // recorder, and the next `start()` clears the leftover keys.
    if (captureError) {
      showErrorToast(captureError);
      return;
    }
    if (!bridge || !capturedShortcut) return;
    void bridge.saveShortcuts({ ...bindings, [recordingAction]: capturedShortcut }).then(
      () => {
        resetKeys();
        setRecordingAction(null);
        showToast({ kind: 'info', text: t('shortcuts.status.shortcutSaved') });
      },
      (reason: unknown) => {
        resetKeys();
        setRecordingAction(null);
        showErrorToast(reason instanceof Error ? reason : t('shortcuts.errors.shortcutSave'));
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
    t,
  ]);

  function startRecording(action: ShortcutAction) {
    if (unavailable || pending) return;
    setRecordingAction(action);
    start();
  }

  async function restoreDefaults() {
    if (!bridge || unavailable || pending || recording) return;
    resetKeys();
    setRecordingAction(null);
    setPending('restore');
    try {
      await bridge.restoreShortcuts();
      showToast({ kind: 'info', text: t('shortcuts.status.defaultsRestored') });
    } catch (reason) {
      if (reason instanceof Error) showErrorToast(reason);
      else showErrorToast(t('shortcuts.errors.defaultsRestore'));
    }
    setPending(null);
  }

  async function changePinned(value: boolean) {
    if (!desktop || unavailable || pending || recording) return;
    resetKeys();
    setRecordingAction(null);
    setPending('pin');
    try {
      await desktop.setPinned(value);
      showToast({ kind: 'info', text: t('shortcuts.status.windowPreferenceSaved') });
    } catch (reason) {
      if (reason instanceof Error) showErrorToast(reason);
      else showErrorToast(t('shortcuts.errors.windowPreferenceSave'));
    }
    setPending(null);
  }

  return {
    bindings,
    pinned,
    recording,
    pending,
    unavailable,
    platform,
    startRecording,
    cancelRecording,
    restoreDefaults,
    changePinned,
  };
}
