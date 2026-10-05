import type { OnboardingBridge } from '../client/contract';
import type { SettingsSnapshot } from '../client/settings-contract';
import type { NativeBridge } from '../native-bridge/client';
import type { WindowMessages } from './window-messages';

/**
 * The panel's half of the welcome guide. The panel page is the one window every launch loads, so
 * it decides when the guide opens: once the service's settings load and say this data dir has not
 * shown it. It asks the shell to open the guide before marking it shown, and before its first
 * selection toolbar push (`onSettings` runs ahead of that sync), so the guide, not the launch, asks
 * for Accessibility. A guide closed early or a quit mid-way does not reopen it; the app menu's
 * Welcome Guide does, and the menu's Replay First-Launch Guide marks it as not shown again
 * (`onboarding.replay`), which runs this same path from the start.
 *
 * It also relays the shell's panel visibility to the other windows, which the guide's hotkey
 * try-out watches.
 */
export function nativeOnboardingTrigger(
  native: NativeBridge,
  messages: WindowMessages,
  setCompleted: (done: boolean) => Promise<SettingsSnapshot>,
): { onSettings: (next: SettingsSnapshot) => void } {
  native.on('window.visibility', ({ visible }) =>
    messages.post({ type: 'panelVisibility', visible }),
  );
  native.on('onboarding.replay', () => {
    void setCompleted(false).catch((error: unknown) => {
      console.error('The welcome guide could not be replayed:', error);
    });
  });
  // Set from the request until the service reports the guide shown, so one pending state opens one
  // guide; a replay's reset then finds it clear.
  let requested = false;
  return {
    onSettings: (next) => {
      if (next.onboardingCompleted) {
        requested = false;
        return;
      }
      if (requested) return;
      requested = true;
      void native.call('onboarding.open', {}).catch((error: unknown) => {
        console.error('The welcome guide could not open:', error);
      });
      void setCompleted(true).catch((error: unknown) => {
        console.error('The welcome guide could not be marked as shown:', error);
      });
    },
  };
}

/** The welcome guide window's own controls (`window.desktop.onboarding`). */
export function nativeOnboarding(native: NativeBridge, messages: WindowMessages): OnboardingBridge {
  return {
    close: async (summon) => void (await native.call('onboarding.close', { summon })),
    settle: async () => void (await native.call('onboarding.settle', {})),
    surface: (rect, radius, fade) => native.post('onboarding.surface', { rect, radius, fade }),
    selection: (rect, text) => native.post('onboarding.selection', { rect, text }),
    onPanelVisibility: (listener) =>
      messages.listen((message) => {
        if (message.type === 'panelVisibility') listener(message.visible);
      }),
  };
}
