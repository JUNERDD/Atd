import { useEffect, useState } from 'react';
import type { OnboardingBridge } from '../../client/contract';
import type { SettingsSnapshot } from '../../client/settings-contract';
import type { OnboardingGoals } from './onboarding-types';

/**
 * The default connection when it can run tasks: connected, with a default model. Its model shows
 * by name when the catalog knows it.
 */
export function readyConnection(snapshot: SettingsSnapshot | null) {
  const connection = snapshot?.connections.find(
    (item) => item.connectionId === snapshot.defaultConnectionId,
  );
  if (!connection?.connected || !connection.defaultModel) return null;
  const model = [...connection.catalog, ...connection.customModels].find(
    (item) => item.id === connection.defaultModel,
  );
  return { connection, model: model?.name ?? connection.defaultModel };
}

/**
 * Whether the user's panel was shown while the guide is open. The shell reports every show and
 * hide; the first show proves the global shortcut works (any summon counts), and it stays proven
 * for the session.
 */
function usePanelShown(onboarding: OnboardingBridge | undefined) {
  const [shown, setShown] = useState(false);
  useEffect(
    () =>
      onboarding?.onPanelVisibility((visible) => {
        if (visible) setShown(true);
      }),
    [onboarding],
  );
  return shown;
}

/**
 * Each goal step's goal, read from the app's real state only (`OnboardingGoals`): the panel shown
 * since the guide opened (hotkey), the system's Accessibility grant (selection), the Screen
 * Recording grant this running app holds (screenshot), a ready default connection (provider).
 */
export function useOnboardingGoals(
  snapshot: SettingsSnapshot | null,
  onboarding: OnboardingBridge | undefined,
): OnboardingGoals {
  const hotkey = usePanelShown(onboarding);
  return {
    hotkey,
    selection: snapshot?.accessibilityTrusted === true,
    screenshot: snapshot?.screenRecordingTrusted === true,
    provider: readyConnection(snapshot) !== null,
  };
}
