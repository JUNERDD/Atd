import type { FocusWriteBridge, WriteOffer } from '../client/agent/bridge';
import type { NativeBridge } from '../native-bridge/client';

/**
 * The panel's writes where the person's focus is now (`FocusWriteBridge`): the latest
 * `text.writeOffer`, which the shell replays as state once the page is ready, so this subscribes
 * before the host's first await; and `text.writeFocused`.
 */
export function nativeFocusWrite(native: NativeBridge): FocusWriteBridge {
  let offer: WriteOffer | null = null;
  const listeners = new Set<() => void>();
  native.on('text.writeOffer', (event) => {
    offer = event.offer ?? null;
    for (const listener of listeners) listener();
  });
  return {
    offer: () => offer,
    onOffer(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    write: (request) => native.call('text.writeFocused', request),
  };
}
