import { screen, type BrowserWindow } from 'electron';
import {
  followWorkArea,
  getPanelBounds,
  getPanelMinimumSize,
  type PanelSize,
  type WorkArea,
} from './window-position';

/**
 * Keeps the task panel placed on its display. Docking records the work area it docked against,
 * so when that work area changes (the Dock resizing, a display rearranging) a panel still in its
 * corner follows it, and a panel the user moved only stays inside the work area.
 */
export class PanelPlacement {
  private docked: WorkArea | null = null;

  constructor(private readonly panel: () => BrowserWindow | null) {}

  /** Bounds that dock a panel of `size` in the bottom-right corner of `workArea`. */
  dockedBounds(workArea: WorkArea, size: PanelSize): WorkArea {
    this.docked = { ...workArea };
    return getPanelBounds(workArea, size);
  }

  /**
   * Follows display changes from now on. Install it before the panel exists: a work area can
   * change while the app is still starting, and a missed change leaves the panel off its corner.
   */
  install() {
    screen.on('display-metrics-changed', (_event, display, metrics) => {
      const panel = this.panel();
      if (!panel || panel.isDestroyed()) return;
      if (!metrics.some((metric) => ['bounds', 'workArea', 'scaleFactor'].includes(metric))) return;
      if (display.id === screen.getDisplayMatching(panel.getBounds()).id) this.reposition();
    });
    screen.on('display-removed', () => this.reposition());
  }

  private reposition() {
    const panel = this.panel();
    if (!panel || panel.isDestroyed()) return;
    const workArea = screen.getDisplayMatching(panel.getBounds()).workArea;
    const minimum = getPanelMinimumSize(workArea);
    panel.setMinimumSize(minimum.width, minimum.height);
    const bounds = panel.getBounds();
    const next = followWorkArea(bounds, this.docked, workArea);
    this.docked = next.docked;
    if (
      next.bounds.x !== bounds.x ||
      next.bounds.y !== bounds.y ||
      next.bounds.width !== bounds.width ||
      next.bounds.height !== bounds.height
    )
      panel.setBounds(next.bounds);
  }
}
