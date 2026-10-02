import type { NativeBridge } from '../native-bridge/client';

/**
 * The selection toolbar's Ask Atd (`selection.ask`). The shell shows the panel before it sends the
 * event, which can reach a page still installing its host, so this subscribes first and holds an
 * Ask until the composer's listener arrives.
 */
export function nativeSelectionAsk(native: NativeBridge): (listener: () => void) => () => void {
  let held = false;
  const listeners = new Set<() => void>();
  native.on('selection.ask', () => {
    held = listeners.size === 0;
    for (const listener of listeners) listener();
  });
  return (listener) => {
    listeners.add(listener);
    if (held) {
      held = false;
      listener();
    }
    return () => listeners.delete(listener);
  };
}
