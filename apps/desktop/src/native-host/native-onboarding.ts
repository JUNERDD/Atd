import { getSettings, patchSettings } from '@atd/agent-client';
import type { PatchSettingsRequest } from '@atd/agent-contracts';
import type { OnboardingBridge } from '../client/contract';
import type { SettingsSnapshot } from '../client/settings-contract';
import type { NativeBridge } from '../native-bridge/client';
import type { NativeConnection } from './native-connection';
import type { WindowMessages } from './window-messages';

/**
 * The panel's half of the welcome guide. The panel page is the one window every launch loads, so
 * it resolves the launch window once the service's settings load. The shell keeps the panel
 * hidden until that decision. It requests the guide before the first selection toolbar push
 * (`onSettings` runs ahead of that sync), so the guide, not the launch, asks for Accessibility.
 * Opening never marks the guide complete: a quit or permission-driven restart resumes it. Only
 * the guide's explicit close records completion; the app menu can start it again afterwards.
 *
 * It also relays the shell's panel visibility to the other windows, which the guide's hotkey
 * try-out watches.
 */
export function nativeOnboardingTrigger(
  native: NativeBridge,
  messages: WindowMessages,
): {
  onSettings: (next: Pick<SettingsSnapshot, 'onboardingCompleted'>) => void;
  onUnavailable: () => void;
} {
  native.on('window.visibility', ({ visible }) =>
    messages.post({ type: 'panelVisibility', visible }),
  );
  // Settings keep arriving while the guide is pending, so one launch opens one guide.
  let requested = false;
  return {
    onSettings: (next) => {
      if (requested) return;
      requested = true;
      void native
        .call('app.startup', { state: next.onboardingCompleted ? 'ready' : 'onboarding' })
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
export function nativeOnboarding(
  native: NativeBridge,
  messages: WindowMessages,
  connection: NativeConnection,
): OnboardingBridge {
  // Navigation, goal changes and close must reach disk in that order. A failed write is reported
  // to its caller without preventing a later user action from saving again.
  let writes = Promise.resolve();
  let closing = false;
  const save = (
    patch: Pick<PatchSettingsRequest, 'onboardingCompleted' | 'onboardingProgress'>,
  ) => {
    const pending = writes.then(async () => {
      await patchSettings(connection.options(), patch);
    });
    writes = pending.catch(() => undefined);
    return pending;
  };
  return {
    getProgress: async () => {
      const { settings } = await getSettings(connection.options());
      return settings.onboardingCompleted ? null : settings.onboardingProgress;
    },
    saveProgress: (progress) =>
      closing
        ? Promise.resolve()
        : save({ onboardingCompleted: false, onboardingProgress: progress }),
    close: async (summon) => {
      closing = true;
      try {
        await save({ onboardingCompleted: true, onboardingProgress: null });
        await native.call('onboarding.close', { summon });
      } catch (error) {
        closing = false;
        throw error;
      }
    },
    settle: async () => void (await native.call('onboarding.settle', {})),
    surface: (rect, radius, fade) => native.post('onboarding.surface', { rect, radius, fade }),
    selection: (rect, text) => native.post('onboarding.selection', { rect, text }),
    onPanelVisibility: (listener) =>
      messages.listen((message) => {
        if (message.type === 'panelVisibility') listener(message.visible);
      }),
  };
}
