import type { DesktopBridge } from '../client/contract';
import type { NativeBridge } from '../native-bridge/client';

/**
 * Coordinates the generic macOS menu entry for main-panel feature modals (`panelModal.setAvailable`
 * and `panelModal.open`). Subscribes before any host `await` so early menu activations wait for
 * the modal host to mount; pushes availability sequentially and deduplicates unchanged flags.
 */
export function nativePanelModals(
  native: NativeBridge,
): Pick<DesktopBridge, 'setPanelModalsAvailable' | 'onPanelModalOpen'> {
  const listeners = new Set<() => void>();
  let waiting = false;
  native.on('panelModal.open', () => {
    waiting = listeners.size === 0;
    for (const listener of listeners) listener();
  });

  let pushed: boolean | null = null;
  let queue = Promise.resolve();
  async function push(available: boolean): Promise<void> {
    if (pushed === available) return;
    await native.call('panelModal.setAvailable', { available });
    pushed = available;
  }

  return {
    setPanelModalsAvailable: (available) => {
      const next = queue.then(() => push(available));
      queue = next.catch(() => undefined);
      return next;
    },
    onPanelModalOpen: (listener) => {
      listeners.add(listener);
      if (waiting) {
        waiting = false;
        listener();
      }
      return () => void listeners.delete(listener);
    },
  };
}
