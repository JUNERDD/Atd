import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppConfirmation } from './app-dialogs';
import type { AppActions } from './use-app-actions';

interface NamedApp {
  id: string;
  name: string;
}

/**
 * The confirmations in front of app actions that lose data: Delete, Clear data, and Restore,
 * which publishes an old version while keeping the newer versions' data. `confirmation` feeds an
 * `AppConfirmDialog`; `onDeleted` runs once a delete landed (a details page then leaves).
 */
export function useAppConfirmations(actions: AppActions, onDeleted?: (appId: string) => void) {
  const { t } = useTranslation('apps');
  const [confirmation, setConfirmation] = useState<AppConfirmation | null>(null);
  return {
    confirmation,
    close: () => setConfirmation(null),
    confirmDelete: (app: NamedApp) =>
      setConfirmation({
        title: t('confirm.deleteTitle', { name: app.name }),
        description: t('confirm.deleteDescription'),
        action: t('confirm.deleteAction'),
        destructive: true,
        onConfirm: () =>
          void actions.remove(app.id).then((deleted) => {
            if (deleted) onDeleted?.(app.id);
          }),
      }),
    confirmClearData: (app: NamedApp) =>
      setConfirmation({
        title: t('confirm.clearTitle', { name: app.name }),
        description: t('confirm.clearDescription'),
        action: t('confirm.clearAction'),
        destructive: true,
        onConfirm: () => void actions.clearData(app.id),
      }),
    confirmRevert: (app: NamedApp, version: number) =>
      setConfirmation({
        title: t('confirm.revertTitle', { version }),
        description: t('confirm.revertDescription', { version }),
        action: t('confirm.revertAction'),
        destructive: false,
        onConfirm: () => void actions.revert(app.id, version),
      }),
  };
}
