import { revokeTaskFolder, taskFolders } from '@atd/agent-client';
import type { FolderBridge } from '../client/contract';
import type { NativeBridge } from '../native-bridge/client';
import type { NativeConnection } from './native-connection';

/**
 * The panel's readable folders: the shell's folder picker (which registers what the user picks)
 * and a task's grants through the relay. A `task` invalidation may mean a grant changed, so it
 * tells the listeners which task to read again.
 */
export function nativeFolders(connection: NativeConnection, native: NativeBridge): FolderBridge {
  const listeners = new Set<(taskId: string) => void>();
  connection.onInvalidate((frame) => {
    if (frame.scope !== 'task' || !frame.taskId) return;
    for (const listener of listeners) listener(frame.taskId);
  });
  return {
    pick: () => native.call('files.pickFolder', {}),
    list: async (taskId) => (await taskFolders(connection.options(), taskId)).folders,
    revoke: async (taskId, folderId) =>
      (await revokeTaskFolder(connection.options(), taskId, folderId)).folders,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
