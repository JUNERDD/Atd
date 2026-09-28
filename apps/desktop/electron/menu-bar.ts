import path from 'node:path';
import {
  app,
  Menu,
  nativeImage,
  Tray,
  type MenuItemConstructorOptions,
  type NativeImage,
} from 'electron';
import {
  menuBarStatus,
  menuBarTooltip,
  type MenuBarState,
  type MenuBarTask,
} from './menu-bar-status';
import type { ConnectionState } from './service/connection';

export interface MenuBarSources {
  /** The panel toggle the global shortcut also runs. */
  toggle: () => void;
  /** The item's menu; built on each open so it reflects the current app state. */
  items: () => MenuItemConstructorOptions[];
  tasks: () => MenuBarTask[];
  onTasksChanged: (listener: () => void) => void;
  connection: () => ConnectionState;
  onConnectionChanged: (listener: () => void) => void;
}

/**
 * Template images from the project Figma file, one per state. The `Template` suffix makes macOS
 * tint them for the menu bar appearance, and `@2x` siblings load for Retina displays.
 */
function stateImage(state: MenuBarState): NativeImage {
  const folder = app.isPackaged
    ? path.join(process.resourcesPath, 'menu-bar')
    : path.join(app.getAppPath(), 'resources/menu-bar');
  return nativeImage.createFromPath(path.join(folder, `${state}Template.png`));
}

/**
 * The macOS menu bar status item: a second entry to the task panel beside the global shortcut,
 * and the one entry that always stays reachable while the Dock icon is hidden. A click toggles
 * the panel like the shortcut does; a right-click or Control/Option-click opens the app menu. Its
 * image and tooltip follow the service connection and the cached tasks.
 */
export class MenuBarItem {
  private tray: Tray | null = null;
  private shown: MenuBarState | null = null;

  constructor(private readonly sources: MenuBarSources) {}

  install() {
    if (process.platform !== 'darwin' || this.tray) return;
    const tray = new Tray(stateImage('idle'));
    this.tray = tray;
    this.shown = 'idle';
    // A double click would otherwise also arrive as two clicks that reveal and hide the panel.
    tray.setIgnoreDoubleClickEvents(true);
    tray.on('click', (event) => {
      if (event.ctrlKey || event.altKey) this.openMenu();
      else this.sources.toggle();
    });
    tray.on('right-click', () => this.openMenu());
    this.sources.onTasksChanged(() => this.refresh());
    this.sources.onConnectionChanged(() => this.refresh());
    this.refresh();
  }

  private openMenu() {
    this.tray?.popUpContextMenu(Menu.buildFromTemplate(this.sources.items()));
  }

  private refresh() {
    const tray = this.tray;
    if (!tray || tray.isDestroyed()) return;
    const status = menuBarStatus(this.sources.tasks(), this.sources.connection());
    if (status.state !== this.shown) {
      tray.setImage(stateImage(status.state));
      this.shown = status.state;
    }
    tray.setToolTip(menuBarTooltip(status));
  }
}
