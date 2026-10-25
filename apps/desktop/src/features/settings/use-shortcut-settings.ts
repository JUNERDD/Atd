import { useCallback, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useSettingsSectionExit } from './settings-navigation';
import { useShortcutCapture } from './use-shortcut-capture';
import { showSettingsSnapshot } from './use-settings';
import {
  DEFAULT_SHORTCUTS,
  doubleTapModifier,
  effectiveAccelerator,
  selectionToolbarDoubleTap,
} from '@atd/agent-contracts';
import {
  DEFAULT_SELECTION_TOOLBAR,
  type MiniPanelOpenOn,
  type SettingsSnapshot,
  type ShortcutAction,
  type ShortcutBindings,
} from '../../client/settings-contract';

/** The actions the shell registers globally, which alone may be a modifier's double-tap. */
const GLOBAL_ACTIONS: readonly ShortcutAction[] = ['togglePanel', 'captureScreenshot'];

/** A desktop window preference the Shortcuts page switches. */
type WindowPreference = 'pin' | 'dock' | 'login' | 'miniPanel' | 'miniPanelOpenOn';

/** Where an error shows: a shortcut's row, a window preference's row, or Restore defaults. */
type ErrorOwner = ShortcutAction | WindowPreference | 'restore';

function shortcutError(
  t: TFunction<'settings'>,
  action: ShortcutAction,
  shortcut: string | null,
  toolbarTap: string | null,
): string {
  if (!shortcut) return t('shortcuts.errors.unsupportedCombination');
  // The selection toolbar's `toggle` mode watches the same gesture as this double-tap.
  if (shortcut === toolbarTap) return t('shortcuts.errors.selectionToolbarDoubleTap');
  if (doubleTapModifier(shortcut)) return '';
  if (
    ['togglePanel', 'captureScreenshot', 'newConversation', 'openSettings'].includes(action) &&
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
  const setMiniPanelShown = desktop?.setMiniPanelShown;
  const setMiniPanelOpenOn = desktop?.setMiniPanelOpenOn;
  // The shell reports the mini panel's state on every change. Until its first report, or where the
  // host has no mini panel to switch, the state is unknown and its controls stay disabled.
  const miniPanelShown = setMiniPanelShown ? (snapshot?.miniPanelShown ?? null) : null;
  const miniPanelOpenOn = setMiniPanelOpenOn ? (snapshot?.miniPanelOpenOn ?? null) : null;
  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(null);
  // `all` while Restore defaults runs; an action while its shortcut saves or resets.
  const [mutation, setMutation] = useState<ShortcutAction | 'all' | null>(null);
  const [preferencePending, setPreferencePending] = useState<
    Partial<Record<WindowPreference, boolean>>
  >({});
  // An owner's undefined entry is a cleared error.
  const [errors, setErrors] = useState<Partial<Record<ErrorOwner, string | undefined>>>({});
  // macOS keeps a new login item off until the user approves it in System Settings.
  const [loginApproval, setLoginApproval] = useState(false);
  // Errors answer the last attempt, so leaving the section clears them. The login-item note
  // describes current state and stays.
  useSettingsSectionExit(() => {
    setRecordingAction(null);
    setErrors({});
  });
  const unavailable = !snapshot || !bridge;
  const toolbarTap = selectionToolbarDoubleTap(
    snapshot?.selectionToolbar ?? DEFAULT_SELECTION_TOOLBAR,
  );
  /** The shortcut change in flight: the action whose row is saving, or `all` for every row. */
  const shortcutBusy = mutation;
  /** Whether `action` presses its default keys; a spelling that differs but collides counts. */
  const isDefault = (action: ShortcutAction) =>
    effectiveAccelerator(bindings[action], platform) ===
    effectiveAccelerator(DEFAULT_SHORTCUTS[action], platform);
  const allDefault = (Object.keys(DEFAULT_SHORTCUTS) as ShortcutAction[]).every(isDefault);

  const setError = useCallback((owner: ErrorOwner, text: string | undefined) => {
    setErrors((current) => ({ ...current, [owner]: text }));
  }, []);

  const { start, cancel, isRecording } = useShortcutCapture({
    doubleTap:
      platform === 'darwin' && recordingAction !== null && GLOBAL_ACTIONS.includes(recordingAction),
    onCancel: () => setRecordingAction(null),
    onRecorded: (shortcut) => {
      if (!recordingAction) return;
      const action = recordingAction;
      setRecordingAction(null);
      const error = shortcutError(t, action, shortcut, toolbarTap);
      if (error) {
        setError(action, error);
        return;
      }
      if (!bridge || !shortcut) return;
      setMutation(action);
      void bridge.saveShortcuts({ ...bindings, [action]: shortcut }).then(
        () => setMutation(null),
        (reason: unknown) => {
          setMutation(null);
          setError(action, failureText(reason, t('shortcuts.errors.shortcutSave')));
        },
      );
    },
  });
  const recording = isRecording ? recordingAction : null;

  function startRecording(action: ShortcutAction) {
    if (unavailable || shortcutBusy) return;
    setError(action, undefined);
    setRecordingAction(action);
    start();
  }

  function restoreDefaults() {
    if (!bridge || unavailable || shortcutBusy || recording || allDefault) return;
    cancel();
    // Every shortcut row starts over; the window preferences keep their own errors.
    setErrors(({ pin, dock, login, miniPanel, miniPanelOpenOn }) => ({
      pin,
      dock,
      login,
      miniPanel,
      miniPanelOpenOn,
    }));
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
    cancel();
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
  async function changeWindowPreference<Value>(
    kind: WindowPreference,
    value: Value,
    save: (desktop: NonNullable<typeof window.desktop>) => Promise<Value>,
  ) {
    if (!desktop || unavailable || preferencePending[kind]) return;
    if (recordingAction) cancel();
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
    miniPanelShown,
    miniPanelOpenOn,
    recording,
    shortcutBusy,
    preferencePending,
    errors,
    /** The login item waits for approval in System Settings while it is still off. */
    loginApprovalNeeded: loginApproval && openAtLogin === false,
    unavailable,
    platform,
    /** Whether the shell may watch the keyboard, which a double-tap needs; null while unknown. */
    accessibilityTrusted: snapshot?.accessibilityTrusted ?? null,
    isDefault,
    allDefault,
    startRecording,
    cancelRecording: cancel,
    restoreDefaults,
    resetShortcut,
    changePinned: (value: boolean) =>
      changeWindowPreference('pin', value, (desktop) => desktop.setPinned(value)),
    changeShowInDock: (value: boolean) =>
      changeWindowPreference('dock', value, (desktop) => desktop.setShowInDock(value)),
    changeOpenAtLogin: (value: boolean) =>
      changeWindowPreference('login', value, (desktop) => desktop.setOpenAtLogin(value)),
    changeMiniPanel: async (value: boolean) => {
      if (setMiniPanelShown)
        await changeWindowPreference('miniPanel', value, () => setMiniPanelShown(value));
    },
    changeMiniPanelOpenOn: async (value: MiniPanelOpenOn) => {
      if (setMiniPanelOpenOn)
        await changeWindowPreference('miniPanelOpenOn', value, () => setMiniPanelOpenOn(value));
    },
  };
}
