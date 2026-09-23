import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { parse } from '../agent/validation';
import type { ServiceConnection } from '../service/connection';
import { isWindowSender } from '../window-content';
import { platformBackend } from './backend';
import { FileAttachRequestSchema, FileSearchRequestSchema } from './contract';
import { FILE_SEARCH_IPC } from './ipc-channels';
import { FileSearchService } from './service';

/**
 * Registers the panel-only search and attach channels. Search plus attach bypasses the native
 * file dialog, so only the panel's main frame may call them; the sender is checked before the
 * payload is parsed.
 */
export function installFileSearch(
  panel: () => BrowserWindow | null,
  connection: ServiceConnection,
) {
  const service = new FileSearchService(
    platformBackend(process.platform),
    connection,
    app.getPath('home'),
    process.platform,
  );
  const assertPanel = (event: IpcMainInvokeEvent) => {
    if (!isWindowSender(event, panel())) throw new Error('Untrusted desktop request');
  };
  ipcMain.handle(FILE_SEARCH_IPC.search, (event, value: unknown) => {
    assertPanel(event);
    return service.search(event.sender.id, parse(FileSearchRequestSchema, value));
  });
  ipcMain.handle(FILE_SEARCH_IPC.attach, (event, value: unknown) => {
    assertPanel(event);
    return service.attach(event.sender.id, parse(FileAttachRequestSchema, value).resultIds);
  });
}
