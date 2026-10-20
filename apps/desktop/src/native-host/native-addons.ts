import { cancelAddon, getAddons, installAddon, removeAddon } from '@atd/agent-client';
import type { AddonsBridge } from '../client/addons-contract';
import type { NativeConnection } from './native-connection';

/** Add-ons over the relay; the lists reload from the `addons` invalidation every client receives. */
export function nativeAddons(connection: NativeConnection): AddonsBridge {
  const options = () => connection.options();
  return {
    list: () => getAddons(options()),
    install: (id) => installAddon(options(), id),
    cancel: (id) => cancelAddon(options(), id),
    remove: (id) => removeAddon(options(), id),
    onChange: (listener) => {
      const stopInvalidate = connection.onInvalidate((frame) => {
        if (frame.scope === 'addons') listener();
      });
      const stopConnected = connection.onConnected(listener);
      return () => {
        stopInvalidate();
        stopConnected();
      };
    },
  };
}
