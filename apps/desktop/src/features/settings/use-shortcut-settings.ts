import { useCallback, useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useShortcutCapture } from './use-shortcut-capture';
import { DEFAULT_SHORTCUTS, effectiveAccelerator } from '@ai/agent-contracts';
import {
  type SettingsSnapshot,
  type ShortcutAction,
  type ShortcutBindings,
} from '../../client/settings-contract';
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
  const showInDock = snapshot?.showInDock ?? false;
  const openAtLogin = snapshot?.openAtLogin ?? null;
  const { keys, start, stop, resetKeys, isRecording } = useShortcutCapture();
  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(null);
  const [mutationPending, setPending] = useState<
    'restore' | 'reset' | 'pin' | 'dock' | 'login' | null
  >(null);
  const unavailable = !snapshot || !bridge;
  const hasRecordedKey = [...keys].some((key) => !MODIFIER_KEYS.has(key));
  const capturedShortcut = recordedKeysToAccelerator(keys, platform);
  const captureError =
    recordingAction && hasRecordedKey ? shortcutError(t, recordingAction, capturedShortcut) : '';
  const capturePending = recordingAction !== null && hasRecordedKey && !captureError;
  const pending = capturePending ? 'shortcut' : mutationPending;
  const recording = isRecording && !hasRecordedKey ? recordingAction : null;
  /** Whether `action` presses its default keys; a spelling that differs but collides counts. */
  const isDefault = (action: ShortcutAction) =>
    effectiveAccelerator(bindings[action], platform) ===
    effectiveAccelerator(DEFAULT_SHORTCUTS[action], platform);
  const allDefault = (Object.keys(DEFAULT_SHORTCUTS) as ShortcutAction[]).every(isDefault);

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

  /** Puts one action back on its default keys, keeping every other binding. */
  async function resetShortcut(action: ShortcutAction) {
    if (!bridge || unavailable || pending || recording) return;
    resetKeys();
    setRecordingAction(null);
    setPending('reset');
    try {
      await bridge.saveShortcuts({ ...bindings, [action]: DEFAULT_SHORTCUTS[action] });
      showToast({ kind: 'info', text: t('shortcuts.status.shortcutReset') });
    } catch (reason) {
      // A default another action now uses is rejected with the service's own message.
      showErrorToast(reason instanceof Error ? reason : t('shortcuts.errors.shortcutSave'));
    }
    setPending(null);
  }

  /** Saves one desktop window preference; all share the pending state and the feedback. */
  async function changeWindowPreference(
    kind: 'pin' | 'dock' | 'login',
    value: boolean,
    save: (desktop: NonNullable<typeof window.desktop>) => Promise<boolean>,
  ) {
    if (!desktop || unavailable || pending || recording) return;
    resetKeys();
    setRecordingAction(null);
    setPending(kind);
    try {
      const applied = await save(desktop);
      // Only a login item differs: macOS keeps it off until the user approves it.
      showToast({
        kind: 'info',
        text:
          applied === value
            ? t('shortcuts.status.windowPreferenceSaved')
            : t('shortcuts.status.openAtLoginApproval'),
      });
    } catch (reason) {
      if (reason instanceof Error) showErrorToast(reason);
      else showErrorToast(t('shortcuts.errors.windowPreferenceSave'));
    }
    setPending(null);
  }

  return {
    bindings,
    pinned,
    showInDock,
    openAtLogin,
    recording,
    pending,
    unavailable,
    platform,
    isDefault,
    allDefault,
    startRecording,
    cancelRecording,
    restoreDefaults,
    resetShortcut,
    changePinned: (value: boolean) =>
      changeWindowPreference('pin', value, (desktop) => desktop.setPinned(value)),
    changeShowInDock: (value: boolean) =>
      changeWindowPreference('dock', value, (desktop) => desktop.setShowInDock(value)),
    changeOpenAtLogin: (value: boolean) =>
      changeWindowPreference('login', value, (desktop) => desktop.setOpenAtLogin(value)),
  };
}
