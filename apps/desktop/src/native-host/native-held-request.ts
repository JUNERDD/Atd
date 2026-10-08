import type { NativeBridge } from '../native-bridge/client';

/**
 * A request the shell hands the panel page as soon as it is ready, without a payload: the selection
 * toolbar's Ask Atd (`selection.ask`) and the mini panel's New task (`task.new`). Either can reach
 * a page still installing its host, so this subscribes first and holds a request until the view's
 * listener arrives. Subscribe it before the host's first await so no delivery is missed.
 */
export function nativeHeldRequest(
  native: NativeBridge,
  event: 'selection.ask' | 'task.new',
): (listener: () => void) => () => void {
  let held = false;
  const listeners = new Set<() => void>();
  native.on(event, () => {
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
