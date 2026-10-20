import type { ViewsBridge } from '../client/contract';
import type { NativeBridge } from '../native-bridge/client';

/**
 * Generative views' windows: the shell opens a view's window (`view.open`), or brings its open
 * window forward, from any window's page. It rejects ids the view origin refuses.
 */
export function nativeViews(native: NativeBridge): ViewsBridge {
  return {
    open: async (request) => void (await native.call('view.open', request)),
  };
}
