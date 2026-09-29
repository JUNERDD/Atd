import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { Type } from 'typebox';
import { AgentClientError, attachFileResults, searchFiles } from '@ai/agent-client';
import {
  FileResultIdsSchema,
  FileSearchQuerySchema,
  type FileSearchReply,
} from '@ai/agent-contracts';
import type { ServiceConnection } from '../service/connection';
import { IPC } from '../../src/client/contract';
import { isWindowSender } from '../window-content';
import { notConnected } from '../../src/client/agent/service-manage';
import type { FileRef } from '../../src/client/agent/task-schema';
import { parse } from '../../src/client/agent/validation';

const AttachRequestSchema = Type.Object(
  { resultIds: FileResultIdsSchema },
  { additionalProperties: false },
);

/**
 * Registers the panel-only search and attach channels, which forward to the service's file
 * routes. Search plus attach bypasses the native file dialog, so only the panel's main frame may
 * call them; the sender is checked before the payload is parsed. Each webContents is its own
 * search channel, so a newer query supersedes only that window's older one.
 */
export function installFileSearch(
  panel: () => BrowserWindow | null,
  connection: ServiceConnection,
) {
  const assertPanel = (event: IpcMainInvokeEvent) => {
    if (!isWindowSender(event, panel())) throw new Error('Untrusted desktop request');
  };
  const service = () => {
    const options = connection.options();
    if (!options) throw notConnected();
    return options;
  };
  const channel = (event: IpcMainInvokeEvent) => `panel-${event.sender.id}`;
  ipcMain.handle(IPC.searchFiles, async (event, value: unknown): Promise<FileSearchReply> => {
    assertPanel(event);
    const query = parse(FileSearchQuerySchema, value);
    return searchFiles(service(), { channel: channel(event), ...query }).catch(rethrow);
  });
  ipcMain.handle(IPC.attachFiles, async (event, value: unknown): Promise<FileRef[]> => {
    assertPanel(event);
    const { resultIds } = parse(AttachRequestSchema, value);
    const request = { channel: channel(event), resultIds };
    const { resources } = await attachFileResults(service(), request).catch(rethrow);
    return resources.map(({ id, name, size, mime }) => ({ id, name, size, type: mime }));
  });
}

/** Service messages are English and path-free; transport failures read as a generic retry. */
function rethrow(error: unknown): never {
  throw new Error(
    error instanceof AgentClientError ? error.message : 'File search failed. Try again.',
  );
}
