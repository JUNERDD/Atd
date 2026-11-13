import type { SaveLocationBridge } from '../client/save-location-contract';
import type { NativeBridge } from '../native-bridge/client';

/** The shell's save-location preference and native folder picker for screenshots and recordings. */
export function nativeSaveLocation(native: NativeBridge): SaveLocationBridge {
  return {
    state: (kind) => native.call('saveLocation.state', { kind }),
    set: (kind, path) => native.call('saveLocation.set', { kind, path }),
    pick: (kind) => native.call('saveLocation.pick', { kind }),
  };
}
