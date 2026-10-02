import { useCallback, useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useSettingsSectionExit } from './settings-navigation';
import { useShortcutCapture } from './use-shortcut-capture';
import { showSettingsSnapshot } from './use-settings';
import { DEFAULT_SHORTCUTS, effectiveAccelerator } from '@atd/agent-contracts';
import {
  type SettingsSnapshot,
  type ShortcutAction,
  type ShortcutBindings,
} from '../../client/settings-contract';
import { recordedKeysToAccelerator } from '../../lib/shortcuts';

const MODIFIER_KEYS = new Set(['meta', 'ctrl', 'alt', 'shift']);

/** A desktop window preference the Shortcuts page switches. */
type WindowPreference = 'pin' | 'dock' | 'login';

/** Where an error shows: a shortcut's row, a window preference's row, or Restore defaults. */
type ErrorOwner = ShortcutAction | WindowPreference | 'restore';

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

/** The service's own message when it gave one (such as a default another action uses). */
function failureText(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

/**
 * The Shortcuts page's state. The bindings save as one document, so one shortcut change runs at a
 * time and the others ignore input meanwhile; each window preference saves on its own. Results
 * show in place (the keys, a switch), and errors show in the row that caused them.
 */
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
  // `all` while Restore defaults runs; an action while its Reset runs.
  const [mutation, setMutation] = useState<ShortcutAction | 'all' | null>(null);
  const [preferencePending, setPreferencePending] = useState<
    Partial<Record<WindowPreference, boolean>>
  >({});
  // An owner's undefined entry is a cleared error.
  const [errors, setErrors] = useState<Partial<Record<ErrorOwner, string | undefined>>>({});
  // macOS keeps a new login item off until the user approves it in System Settings.
  const [loginApproval, setLoginApproval] = useState(false);
  // Errors answer the last attempt, so leaving the section clears them. The section can't be left
  // while a row records; dropping the row also drops a rejected capture's error, and the next
  // `start()` clears its leftover keys. The login-item note describes current state and stays.
  useSettingsSectionExit(() => {
    setRecordingAction(null);
    setErrors({});
  });
  const unavailable = !snapshot || !bridge;
  const hasRecordedKey = [...keys].some((key) => !MODIFIER_KEYS.has(key));
  const capturedShortcut = recordedKeysToAccelerator(keys, platform);
  const captureError =
    recordingAction && hasRecordedKey ? shortcutError(t, recordingAction, capturedShortcut) : '';
  const capturePending = recordingAction !== null && hasRecordedKey && !captureError;
  /** The shortcut change in flight: the action whose row is saving, or `all` for every row. */
  const shortcutBusy = capturePending ? recordingAction : mutation;
  const recording = isRecording && !hasRecordedKey ? recordingAction : null;
  /** Whether `action` presses its default keys; a spelling that differs but collides counts. */
  const isDefault = (action: ShortcutAction) =>
    effectiveAccelerator(bindings[action], platform) ===
    effectiveAccelerator(DEFAULT_SHORTCUTS[action], platform);
  const allDefault = (Object.keys(DEFAULT_SHORTCUTS) as ShortcutAction[]).every(isDefault);

  const setError = useCallback((owner: ErrorOwner, text: string | undefined) => {
    setErrors((current) => ({ ...current, [owner]: text }));
  }, []);

  const endRecording = useCallback(() => {
    stop();
    resetKeys();
    setRecordingAction(null);
  }, [resetKeys, stop]);

  useEffect(() => {
    if (!isRecording || !recordingAction || !hasRecordedKey) return;
    stop();
    // Stopping alone ends a rejected attempt: `recording`, `shortcutBusy` and the row's error
    // derive from the stopped recorder, and the next `start()` clears the leftover keys.
    if (captureError) return;
    if (!bridge || !capturedShortcut) return;
    const action = recordingAction;
    void bridge.saveShortcuts({ ...bindings, [action]: capturedShortcut }).then(
      () => {
        resetKeys();
        setRecordingAction(null);
      },
      (reason: unknown) => {
        resetKeys();
        setRecordingAction(null);
        setError(action, failureText(reason, t('shortcuts.errors.shortcutSave')));
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
    setError,
    stop,
    t,
  ]);
  // A rejected combination stays the row's error until the next attempt clears its keys.
  const rowErrors =
    recordingAction && captureError ? { ...errors, [recordingAction]: captureError } : errors;

  function startRecording(action: ShortcutAction) {
    if (unavailable || shortcutBusy) return;
    setError(action, undefined);
    setRecordingAction(action);
    start();
  }

  function restoreDefaults() {
    if (!bridge || unavailable || shortcutBusy || recording || allDefault) return;
    endRecording();
    // Every shortcut row starts over; the window preferences keep their own errors.
    setErrors(({ pin, dock, login }) => ({ pin, dock, login }));
    setMutation('all');
    void bridge.restoreShortcuts().then(
      (snapshot) => {
        showSettingsSnapshot(snapshot);
        setMutation(null);
      },
      (reason: unknown) => {
        setError('restore', failureText(reason, t('shortcuts.errors.defaultsRestore')));
        setMutation(null);
      },
    );
  }

  /** Puts one action back on its default keys, keeping every other binding. Resolves true once saved. */
  function resetShortcut(action: ShortcutAction): Promise<boolean> {
    if (!bridge || unavailable || shortcutBusy || recording) return Promise.resolve(false);
    endRecording();
    setError(action, undefined);
    setMutation(action);
    return bridge.saveShortcuts({ ...bindings, [action]: DEFAULT_SHORTCUTS[action] }).then(
      (snapshot) => {
        showSettingsSnapshot(snapshot);
        setMutation(null);
        return true;
      },
      (reason: unknown) => {
        // A default another action now uses is rejected with the service's own message.
        setError(action, failureText(reason, t('shortcuts.errors.shortcutSave')));
        setMutation(null);
        return false;
      },
    );
  }

  /** Saves one desktop window preference; each has its own pending state and error. */
  async function changeWindowPreference(
    kind: WindowPreference,
    value: boolean,
    save: (desktop: NonNullable<typeof window.desktop>) => Promise<boolean>,
  ) {
    if (!desktop || unavailable || preferencePending[kind]) return;
    if (recordingAction) endRecording();
    setError(kind, undefined);
    if (kind === 'login') setLoginApproval(false);
    setPreferencePending((current) => ({ ...current, [kind]: true }));
    try {
      const applied = await save(desktop);
      // Only a login item differs: macOS keeps it off until the user approves it.
      if (kind === 'login' && applied !== value) setLoginApproval(true);
    } catch (reason) {
      setError(kind, failureText(reason, t('shortcuts.errors.windowPreferenceSave')));
    }
    setPreferencePending((current) => ({ ...current, [kind]: false }));
  }

  return {
    bindings,
    pinned,
    showInDock,
    openAtLogin,
    recording,
    shortcutBusy,
    preferencePending,
    errors: rowErrors,
    /** The login item waits for approval in System Settings while it is still off. */
    loginApprovalNeeded: loginApproval && openAtLogin === false,
    unavailable,
    platform,
    isDefault,
    allDefault,
    startRecording,
    cancelRecording: endRecording,
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
