import type { OnboardingBridge } from '../client/contract';
import type { SettingsSnapshot } from '../client/settings-contract';
import type { NativeBridge } from '../native-bridge/client';
import type { WindowMessages } from './window-messages';

/**
 * The panel's half of the welcome guide. The panel page is the one window every launch loads, so
 * it resolves the launch window once the service's settings load. The shell keeps the panel
 * hidden until that decision. It requests the guide before the first selection toolbar push
 * (`onSettings` runs ahead of that sync), so the guide, not the launch, asks for Accessibility.
 * It marks the guide as shown only after the shell confirms it opened. A guide closed early
 * or a quit mid-way does not reopen it; the app menu's
 * Welcome Guide does, without touching the setting.
 *
 * It also relays the shell's panel visibility to the other windows, which the guide's hotkey
 * try-out watches.
 */
export function nativeOnboardingTrigger(
  native: NativeBridge,
  messages: WindowMessages,
  markShown: () => Promise<void>,
): {
  onSettings: (next: Pick<SettingsSnapshot, 'onboardingCompleted'>) => void;
  onUnavailable: () => void;
} {
  native.on('window.visibility', ({ visible }) =>
    messages.post({ type: 'panelVisibility', visible }),
  );
  // Settings can arrive again before the service reports the guide shown, so one launch opens
  // one guide.
  let requested = false;
  return {
    onSettings: (next) => {
      if (requested) return;
      requested = true;
      void native
        .call('app.startup', { state: next.onboardingCompleted ? 'ready' : 'onboarding' })
        .then(({ onboardingShown }) => {
          if (onboardingShown)
            void markShown().catch((error: unknown) => {
              console.error('The welcome guide could not be marked as shown:', error);
            });
        })
        .catch((error: unknown) => {
          requested = false;
          console.error('The launch window could not open:', error);
        });
    },
    onUnavailable: () => {
      if (requested) return;
      void native.call('app.startup', { state: 'unavailable' }).catch((error: unknown) => {
        console.error('The unavailable service could not be shown:', error);
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
