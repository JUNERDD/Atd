import { publishFileDrag } from '../lib/file-drag';
import { publishImportedFiles } from '../lib/imported-files';
import type { NativeBridge } from '../native-bridge/client';
import { setSystemAppearance } from '../theme/panel-background/system-appearance';
import { setReducedTransparency, setWindowActive, setWindowVisible } from '../window-state';
import { publishDragRegions } from './drag-regions';

/**
 * Subscribes to shell window-state and appearance events before the first `await` so initial
 * replay events (such as hidden `window.visibility` on launch) are never dropped during async
 * settings hydration.
 */
export function subscribeNativeWindowState(native: NativeBridge): void {
  native.on('window.active', ({ active }) => setWindowActive(active));
  native.on('window.visibility', ({ visible }) => setWindowVisible(visible));
  native.on('accessibility.reduceTransparency', ({ reduce }) => setReducedTransparency(reduce));
  native.on('appearance.system', setSystemAppearance);
}

/** Wires surface-level file import/drag events and native window drag regions. */
export function attachNativeSurfaceDom(
  native: NativeBridge,
  surface: 'panel' | 'settings' | 'onboarding' | 'view',
): void {
  if (surface === 'panel') {
    native.on('resources.imported', ({ resources, folders, failures }) =>
      publishImportedFiles({ files: resources, folders, failures }),
    );
    native.on('files.drag', publishFileDrag);
  }
  publishDragRegions(native, document.getElementById('root') ?? document.body);
}
