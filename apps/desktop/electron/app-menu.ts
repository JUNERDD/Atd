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

/** Application menu: panel, settings, T2 migration, quit. */
export function installAppMenu(
  showPanel: () => void,
  hidePanel: () => void,
  settings: SettingsService,
) {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'AI',
        submenu: [
          { label: 'Show task panel', click: showPanel },
          { label: 'Hide task panel', click: hidePanel },
          {
            label: 'Settings…',
            click: () => {
              void settings
                .open()
                .catch(() =>
                  dialog.showErrorBox(
                    'Could not open settings',
                    'The settings window could not be opened.',
                  ),
                );
            },
          },
          { type: 'separator' },
          {
            // T2 migration-only: explicit credential upload to a running
            // service. T6 pure client has no local executions to pause.
            label: 'Migrate to Agent Service…',
            click: () => {
              void runServiceMigration().catch((error: unknown) =>
                dialog.showErrorBox(
                  'Migration failed',
                  error instanceof Error ? error.message : 'The migration could not finish.',
                ),
              );
            },
          },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      editMenu(),
      ...(!app.isPackaged ? [{ role: 'viewMenu' as const }] : []),
    ]),
  );
}
