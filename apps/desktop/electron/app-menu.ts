import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  webContents,
  type MenuItemConstructorOptions,
} from 'electron';
import { IPC, type EditCommand } from './contract';
import { runServiceMigration } from './migration/index';
import type { SettingsService } from './settings-service';
import type { Updater } from './updater';

/**
 * Undo and Redo are app items instead of roles. A role runs Blink's native undo, whose stack never
 * sees edits a CodeMirror editor handles itself (Backspace, Enter, paste, chips, rebuilt drafts),
 * so the renderer routes the command to the focused editor's history or to the native command.
 * Shortcuts reach the page first and only unhandled ones reach the menu, so a shortcut the editor
 * consumes never also fires the item.
 */
function editCommandItem(
  command: EditCommand,
  label: string,
  accelerator: string,
): MenuItemConstructorOptions {
  return {
    label,
    accelerator,
    click: (_item, window) => {
      if (!(window instanceof BrowserWindow)) return;
      const focused = webContents.getFocusedWebContents();
      // DevTools (development builds only) keeps the native command, as the role item did.
      if (focused && focused !== window.webContents) focused[command]();
      else window.webContents.send(IPC.editCommand, command);
    },
  };
}

/** Electron's default Edit menu, except for Undo and Redo. */
function editMenu(): MenuItemConstructorOptions {
  const platformItems: MenuItemConstructorOptions[] =
    process.platform === 'darwin'
      ? [
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { role: 'selectAll' },
          { type: 'separator' },
          {
            label: 'Substitutions',
            submenu: [
              { role: 'showSubstitutions' },
              { type: 'separator' },
              { role: 'toggleSmartQuotes' },
              { role: 'toggleSmartDashes' },
              { role: 'toggleTextReplacement' },
            ],
          },
          { label: 'Speech', submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] },
        ]
      : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }];
  return {
    label: 'Edit',
    submenu: [
      editCommandItem('undo', 'Undo', 'CommandOrControl+Z'),
      editCommandItem(
        'redo',
        'Redo',
        process.platform === 'win32' ? 'Control+Y' : 'Shift+CommandOrControl+Z',
      ),
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      ...platformItems,
    ],
  };
}

/** What the application menu and the menu bar status item's menu can do. */
export interface AppActions {
  showPanel: () => void;
  hidePanel: () => void;
  settings: SettingsService;
  /** Replaces the local agent service; also the way back after automatic restarts gave up. */
  restartService: () => Promise<void>;
  /** Reveals the folder with the local agent service's log files. */
  showServiceLogs: () => Promise<void>;
  /** Automatic updates: Check for Updates…, and Restart to Update once one is ready. */
  updates: Updater;
}

/** A click handler that runs `action` and reports a rejection in an error box. */
function reportFailure(action: () => Promise<void>, title: string, fallback: string): () => void {
  return () => {
    void action().catch((error: unknown) =>
      dialog.showErrorBox(title, error instanceof Error ? error.message : fallback),
    );
  };
}

/** Check for Updates…, plus Restart to Update once a downloaded update is ready. */
function updateItems(updates: Updater): MenuItemConstructorOptions[] {
  return [
    { type: 'separator' },
    {
      label: 'Check for Updates…',
      click: reportFailure(
        () => updates.checkForUpdates(),
        'Could not check for updates',
        'The update check could not finish.',
      ),
    },
    ...(updates.current.status === 'ready'
      ? [
          {
            label: 'Restart to Update',
            click: reportFailure(
              () => updates.restartToUpdate(),
              'Could not restart to update',
              'The update could not be installed.',
            ),
          },
        ]
      : []),
  ];
}

/**
 * The app's everyday items: panel, settings, updates, the service actions, then
 * `extras` and Quit. The application menu and the menu bar status item's menu share them, since a
 * hidden Dock icon hides the application menu.
 */
export function appItems(
  actions: AppActions,
  extras: MenuItemConstructorOptions[] = [],
): MenuItemConstructorOptions[] {
  return [
    { label: 'Show task panel', click: actions.showPanel },
    { label: 'Hide task panel', click: actions.hidePanel },
    {
      label: 'Settings…',
      click: () => {
        void actions.settings
          .open()
          .catch(() =>
            dialog.showErrorBox(
              'Could not open settings',
              'The settings window could not be opened.',
            ),
          );
      },
    },
    ...updateItems(actions.updates),
    { type: 'separator' },
    {
      label: 'Restart Agent Service',
      click: reportFailure(
        actions.restartService,
        'Could not restart the agent service',
        'The agent service could not be restarted.',
      ),
    },
    {
      label: 'Show Service Logs',
      click: reportFailure(
        actions.showServiceLogs,
        'Could not show the service logs',
        'The log folder could not be opened.',
      ),
    },
    { type: 'separator' },
    ...extras,
    { role: 'quit' },
  ];
}

/**
 * T2 migration-only: explicit credential upload to a running service. T6 pure client has no local
 * executions to pause. The application menu keeps it; the status item's everyday menu does not.
 */
const migrationItem: MenuItemConstructorOptions = {
  label: 'Migrate to Agent Service…',
  click: () => {
    void runServiceMigration().catch((error: unknown) =>
      dialog.showErrorBox(
        'Migration failed',
        error instanceof Error ? error.message : 'The migration could not finish.',
      ),
    );
  },
};

/**
 * Application menu: the app's items with the migration before Quit, Edit, and dev-only View. The
 * menu is a snapshot, so call this again whenever the items' state changes (such as
 * `Updater.onChange`); the status item's menu rebuilds itself on every open.
 */
export function installAppMenu(actions: AppActions) {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: 'AI', submenu: appItems(actions, [migrationItem, { type: 'separator' }]) },
      editMenu(),
      ...(!app.isPackaged ? [{ role: 'viewMenu' as const }] : []),
    ]),
  );
}
