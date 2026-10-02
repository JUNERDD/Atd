import { useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { FolderRef } from '@atd/agent-contracts';
import { showToast } from '../../components/toast-store';
import { queryClient } from '../../lib/query-client';

const NO_FOLDERS: FolderRef[] = [];
const foldersKey = (taskId: string) => ['taskFolders', taskId] as const;

/**
 * The folders a task may read, which its messages granted, and their revocation. The list loads
 * with the task's session menu and again whenever the service says the task changed, which a grant
 * or a revocation from any window does; a revoke shows the folders it answers at once. Without the
 * panel's folder bridge (the settings window, tests) the list stays empty. A failed load leaves it
 * empty too: the menu then shows no folder group rather than an error.
 */
export function useTaskFolders(taskId: string): {
  folders: FolderRef[];
  revoke: (folder: FolderRef) => void;
  revoking: boolean;
} {
  const { t } = useTranslation('panel');
  const bridge = window.desktop?.folders;
  const { data } = useQuery(
    {
      queryKey: foldersKey(taskId),
      queryFn: () => {
        if (!bridge) throw new Error('Open the desktop app to manage folders.');
        return bridge.list(taskId);
      },
      enabled: Boolean(bridge),
      meta: { errorToast: false },
    },
    queryClient,
  );
  useEffect(
    () =>
      bridge?.onChange((changed) => {
        if (changed === taskId)
          void queryClient.invalidateQueries({ queryKey: foldersKey(changed) });
      }),
    [bridge, taskId],
  );
  const revoking = useMutation(
    {
      mutationKey: ['taskFolders', 'revoke', taskId],
      mutationFn: (folder: FolderRef) => {
        if (!bridge) throw new Error('Open the desktop app to manage folders.');
        return bridge.revoke(taskId, folder.id);
      },
      onSuccess: (remaining, folder) => {
        queryClient.setQueryData(foldersKey(taskId), remaining);
        showToast({ kind: 'info', text: t('session.folders.revoked', { name: folder.name }) });
      },
    },
    queryClient,
  );
  return {
    folders: data ?? NO_FOLDERS,
    revoke: (folder) => revoking.mutate(folder),
    revoking: revoking.isPending,
  };
}
