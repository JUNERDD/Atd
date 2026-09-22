import { BrowserWindow, screen } from 'electron';
import { constrainPanelBounds, type WorkArea } from './window-position';
import { loadWindowContent, rendererPreferences, secureWindowContent } from './window-content';

function settingsBounds(workArea: WorkArea): WorkArea {
  const width = Math.min(1000, workArea.width);
  const height = Math.min(720, workArea.height);
  return {
    x: workArea.x + Math.floor((workArea.width - width) / 2),
    y: workArea.y + Math.floor((workArea.height - height) / 2),
    width,
    height,
  };
}

export class SettingsWindow {
  private window: BrowserWindow | null = null;

  get current(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  async open(hash = 'settings'): Promise<void> {
    if (this.current) {
      if (this.current.isMinimized()) this.current.restore();
      this.current.show();
      this.current.focus();
      return;
    }
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const window = new BrowserWindow({
      ...settingsBounds(workArea),
      title: 'AI Settings',
      frame: true,
      backgroundColor: '#00000000',
      minWidth: Math.min(320, workArea.width),
      minHeight: Math.min(400, workArea.height),
      resizable: true,
      minimizable: true,
      maximizable: true,
      fullscreenable: false,
      hasShadow: true,
      roundedCorners: true,
      show: false,
      // Native material owns the outer clipping, desktop blur, edge, and shadow.
      ...(process.platform === 'darwin'
        ? {
            titleBarStyle: 'hidden' as const,
            trafficLightPosition: { x: 16, y: 18 },
            vibrancy: 'hud' as const,
            visualEffectState: 'active' as const,
          }
        : {}),
      webPreferences: rendererPreferences,
    });
    this.window = window;
    const positionControls = () => {
      if (process.platform === 'darwin' && !window.isDestroyed())
        // Narrow layouts put the buttons on the title row, so their ~14px circles center on it:
        // the 52px drawer bar and the 28px controls strip both center content at 26.
        window.setWindowButtonPosition(
          window.getContentBounds().width < 760 ? { x: 28, y: 19 } : { x: 16, y: 18 },
        );
    };
    window.on('resize', positionControls);
    positionControls();
    secureWindowContent(window);
    const reposition = () => {
      if (window.isDestroyed()) return;
      const display = screen.getDisplayMatching(window.getBounds());
      window.setMinimumSize(
        Math.min(320, display.workArea.width),
        Math.min(400, display.workArea.height),
      );
      if (!window.isMaximized()) {
        const bounds = window.getBounds();
        const next = constrainPanelBounds(bounds, display.workArea);
        if (
          next.x !== bounds.x ||
          next.y !== bounds.y ||
          next.width !== bounds.width ||
          next.height !== bounds.height
        ) {
          window.setBounds(next);
        }
      }
    };
    screen.on('display-metrics-changed', reposition);
    screen.on('display-removed', reposition);
    window.on('closed', () => {
      if (this.window === window) this.window = null;
      screen.removeListener('display-metrics-changed', reposition);
      screen.removeListener('display-removed', reposition);
    });
    window.once('ready-to-show', () => {
      if (window.isDestroyed()) return;
      window.show();
      window.focus();
    });
    try {
      await loadWindowContent(window, hash);
    } catch {
      if (!window.isDestroyed()) window.destroy();
      throw new Error('The settings window could not be opened.');
    }
  }

  close() {
    this.current?.close();
  }
}
