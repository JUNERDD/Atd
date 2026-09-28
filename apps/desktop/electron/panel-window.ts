import { BrowserWindow } from 'electron';
import { rendererPreferences, reportRendererExit, secureWindowContent } from './window-content';
import { getPanelMinimumSize, type PanelSize, type WorkArea } from './window-position';

/**
 * Only a manual edge drag replaces the stored size; programmatic re-docking and
 * work-area clamping keep the user's preference. The trailing debounce saves the
 * final bounds once the drag settles.
 */
function rememberPanelSize(window: BrowserWindow, save: (size: PanelSize) => Promise<void>) {
  let pending: ReturnType<typeof setTimeout> | undefined;
  window.on('will-resize', () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      if (window.isDestroyed()) return;
      const { width, height } = window.getNormalBounds();
      save({ width, height }).catch((error: unknown) => {
        console.error('Could not save the panel size:', error);
      });
    }, 300);
  });
}

/**
 * The task panel's native window at `bounds` on `workArea`, secured and hidden until its content
 * loads. The caller owns its lifecycle: showing, closing and loading content.
 */
export function createPanelWindow(options: {
  bounds: WorkArea;
  workArea: WorkArea;
  pinned: boolean;
  saveSize: (size: PanelSize) => Promise<void>;
}): BrowserWindow {
  // macOS vibrancy owns the window surface, including its native edge and shadow.
  // Other platforms need a transparent backing, which Electron cannot resize reliably.
  const transparent = process.platform !== 'darwin';
  const minimum = getPanelMinimumSize(options.workArea);
  const window = new BrowserWindow({
    ...options.bounds,
    title: 'AI',
    // macOS keeps its native traffic lights over a hidden title bar; every other platform draws
    // the panel chrome in the renderer instead.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 16, y: 18 } }
      : { frame: false }),
    transparent,
    // The renderer owns the panel tint; keep the native backing clear to avoid double fills.
    backgroundColor: '#00000000',
    alwaysOnTop: options.pinned,
    resizable: !transparent,
    // The macOS traffic lights replace the in-panel chrome, so the green button stays enabled and
    // zooms the panel; like the settings window it never enters fullscreen.
    maximizable: true,
    fullscreenable: false,
    minWidth: minimum.width,
    minHeight: minimum.height,
    hasShadow: true,
    roundedCorners: true,
    show: false,
    // HUD provides native blur beneath the renderer's content surface, even when unfocused.
    ...(process.platform === 'darwin'
      ? { vibrancy: 'hud' as const, visualEffectState: 'active' as const }
      : {}),
    webPreferences: rendererPreferences,
  });
  secureWindowContent(window);
  reportRendererExit(window, 'panel');
  rememberPanelSize(window, options.saveSize);
  return window;
}
