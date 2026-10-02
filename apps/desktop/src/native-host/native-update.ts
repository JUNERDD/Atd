import type { UpdateBridge } from '../client/contract';
import type { NativeBridge } from '../native-bridge/client';

/**
 * The app update the shell downloaded. The shell sends `update.state` to the panel on each change
 * and replays it when the page becomes ready, which can happen before the rest of the host is
 * installed, so this subscribes first and keeps the last value for later listeners.
 */
export function nativeUpdate(native: NativeBridge): UpdateBridge {
  let version: string | null = null;
  const listeners = new Set<(version: string | null) => void>();
  native.on('update.state', (state) => {
    version = state.version;
    for (const listener of listeners) listener(version);
  });
  return {
    install: () => native.post('update.install', {}),
    onState(listener) {
      listeners.add(listener);
      listener(version);
      return () => listeners.delete(listener);
    },
  };
}
