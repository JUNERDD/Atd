import { ipcRenderer } from 'electron';
import type { FileRef } from '../agent/task-schema';
// Type-only: a value import would bundle the request schemas into the preload.
import type { FileSearchBridge, FileSearchReply } from './contract';
import { FILE_SEARCH_IPC } from './ipc-channels';

export const fileSearchBridge: FileSearchBridge = {
  search: (request) =>
    ipcRenderer.invoke(FILE_SEARCH_IPC.search, request) as Promise<FileSearchReply>,
  attach: (resultIds) =>
    ipcRenderer.invoke(FILE_SEARCH_IPC.attach, { resultIds }) as Promise<FileRef[]>,
};
