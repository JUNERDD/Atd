import type { AboutBridge, AppUpdateState, UpdateBridge } from '../client/contract';
import type { NativeBridge } from '../native-bridge/client';

/**
 * The app update the shell downloads and installs. The shell sends `update.state` to the panel on
 * each change and replays it when the page becomes ready, which can happen before the rest of the
 * host is installed, so this subscribes first and keeps the last value for later listeners.
 */
export function nativeUpdate(native: NativeBridge): UpdateBridge {
  let state: AppUpdateState = { phase: 'idle' };
  const listeners = new Set<(state: AppUpdateState) => void>();
  native.on('update.state', (next) => {
    state = next;
    for (const listener of listeners) listener(state);
  });
  return {
    install: () => native.post('update.install', {}),
    // A check while an update is under way moves it into Sparkle's own windows.
    show: () => native.post('update.check', {}),
    onState(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
  };
}

/** The running app's version and the update check the About page offers, in every window. */
export function nativeAbout(native: NativeBridge): AboutBridge {
  return {
    info: () => native.call('app.about', {}),
    checkForUpdates: () => native.post('update.check', {}),
  };
}
