import { app, dialog, Menu } from 'electron';
import { runServiceMigration } from './migration/index';
import type { SettingsService } from './settings-service';

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
      { role: 'editMenu' },
      ...(!app.isPackaged ? [{ role: 'viewMenu' as const }] : []),
    ]),
  );
}
