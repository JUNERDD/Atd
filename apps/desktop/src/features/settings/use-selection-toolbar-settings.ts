import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_SELECTION_TOOLBAR,
  MAX_EXCLUDED_APPS,
  type ExcludedApp,
  type SelectionToolbarActivation,
  type SelectionToolbarKey,
  type SelectionToolbarSettings,
  type SettingsSnapshot,
} from '../../client/settings-contract';
import { queryClient } from '../../lib/query-client';
import { useSettingsSectionExit } from './settings-navigation';
import { useActivationKeysCapture } from './use-activation-keys-capture';
import { showSettingsSnapshot } from './use-settings';

/** Each activation key's accelerator part, in the order app shortcuts list modifiers. */
const KEY_ACCELERATORS: [SelectionToolbarKey, string][] = [
  ['command', 'Command'],
  ['option', 'Alt'],
  ['shift', 'Shift'],
];

/**
 * An activation key combination as an accelerator (`Command+Alt`), so it reads and draws with the
 * shortcut helpers (`shortcutKeys`, `useHeldKeys`) in the same order as the app's shortcuts.
 */
export function activationAccelerator(keys: readonly SelectionToolbarKey[]): string {
  return KEY_ACCELERATORS.filter(([key]) => keys.includes(key))
    .map(([, part]) => part)
    .join('+');
}

/** Where an error shows: under the switch, the activation, the HUD switch, or the apps. */
type ErrorOwner = 'toggle' | 'activation' | 'hud' | 'apps';

/**
 * `apps` added to `current` in pick order: an app already listed (by bundle id) stays where it is,
 * and null when the result would pass the cap.
 */
export function withExcludedApps(
  current: readonly ExcludedApp[],
  apps: readonly ExcludedApp[],
): ExcludedApp[] | null {
  const next = [...current];
  for (const app of apps) if (!next.some((item) => item.bundleId === app.bundleId)) next.push(app);
  return next.length > MAX_EXCLUDED_APPS ? null : next;
}

/**
 * The selection toolbar's settings on the General page and in the welcome guide. Every change
 * saves the whole value through the service, whose answer replaces the cached snapshot at once;
 * one save runs at a time, and its failure shows beside the control that caused it. The activation
 * keys are recorded like a shortcut (`useActivationKeysCapture`) and save when released. The Accessibility grant is the shell's: the page
 * only reads it and opens the system's prompt and pane.
 */
export function useSelectionToolbarSettings(snapshot: SettingsSnapshot | null) {
  const { t } = useTranslation('settings');
  const bridge = window.desktop?.settings;
  const value = snapshot?.selectionToolbar ?? DEFAULT_SELECTION_TOOLBAR;
  const [errors, setErrors] = useState<Partial<Record<ErrorOwner, string>>>({});
  // Errors answer the last attempt; after leaving the section the page starts clean.
  useSettingsSectionExit(() => setErrors({}));
  const saving = useMutation(
    {
      mutationKey: ['settings', 'selectionToolbar'],
      mutationFn: (next: SelectionToolbarSettings) => {
        if (!bridge) throw new Error('Open the desktop app to change settings.');
        return bridge.saveSelectionToolbar(next);
      },
      onSuccess: showSettingsSnapshot,
      meta: { errorToast: false },
    },
    queryClient,
  );
  const unavailable = !bridge || !snapshot;
  const pending = saving.isPending;

  // The handlers report failures in place and reset after the try statement (React Compiler).
  async function save(owner: ErrorOwner, next: SelectionToolbarSettings) {
    if (unavailable || pending) return;
    setErrors({});
    try {
      await saving.mutateAsync(next);
    } catch {
      setErrors({ [owner]: t('selectionToolbar.errors.save') });
    }
  }

  const capture = useActivationKeysCapture((result) => {
    if ('invalid' in result)
      setErrors({ activation: t('selectionToolbar.activation.errors.keys') });
    else if (result.keys.join() !== value.activationKeys.join())
      void save('activation', { ...value, activationKeys: result.keys });
  });

  function toggleRecording() {
    if (capture.recording) return capture.cancel();
    if (unavailable || pending) return;
    setErrors({});
    capture.start();
  }

  async function addApps() {
    if (!bridge || unavailable || pending) return;
    setErrors({});
    let picked: ExcludedApp[];
    try {
      picked = await bridge.pickApps();
    } catch {
      setErrors({ apps: t('selectionToolbar.errors.pick') });
      return;
    }
    if (!picked.length) return;
    const excludedApps = withExcludedApps(value.excludedApps, picked);
    if (!excludedApps)
      setErrors({ apps: t('selectionToolbar.errors.limit', { max: MAX_EXCLUDED_APPS }) });
    else if (excludedApps.length !== value.excludedApps.length)
      await save('apps', { ...value, excludedApps });
  }

  async function openAccessibility() {
    if (!bridge) return;
    setErrors({});
    try {
      await bridge.requestAccessibility();
    } catch {
      setErrors({ toggle: t('selectionToolbar.errors.accessibility') });
    }
  }

  return {
    value,
    unavailable,
    pending,
    errors,
    /** False only once the shell reported it; null while unknown, which shows no warning. */
    trusted: snapshot?.accessibilityTrusted ?? null,
    setEnabled: (enabled: boolean) => void save('toggle', { ...value, enabled }),
    setActivation: (activation: SelectionToolbarActivation) =>
      void save('activation', { ...value, activation }),
    setShowHud: (showHud: boolean) => void save('hud', { ...value, showHud }),
    /** The activation keys record new keys (or stop recording). */
    recordingKeys: capture.recording,
    toggleRecording,
    cancelRecording: capture.cancel,
    removeApp: (bundleId: string) =>
      void save('apps', {
        ...value,
        excludedApps: value.excludedApps.filter((app) => app.bundleId !== bundleId),
      }),
    addApps: () => void addApps(),
    openAccessibility: () => void openAccessibility(),
  };
}
