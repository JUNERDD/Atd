import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@atd/ui/components/alert-dialog';
import type { Connection } from '../../client/providers/schema';

/**
 * A destructive connection action that asks first: disconnect forgets the credential and keeps
 * the connection; remove deletes the connection itself.
 */
export interface ConnectionConfirm {
  action: 'disconnect' | 'remove';
  connection: Connection;
}

/**
 * Confirms a disconnect or a removal. The dialog stays open, its buttons disabled, while the
 * operation runs; `onConfirm` closes it once the operation succeeds.
 */
export function ConnectionConfirmDialog({
  confirm,
  isDefault,
  pending,
  onDismiss,
  onConfirm,
}: {
  confirm: ConnectionConfirm | null;
  isDefault: boolean;
  pending: boolean;
  onDismiss: () => void;
  onConfirm: (confirm: ConnectionConfirm) => void;
}) {
  const { t } = useTranslation('settings');
  const action = confirm?.action ?? 'disconnect';
  return (
    <AlertDialog
      open={Boolean(confirm)}
      onOpenChange={(open) => {
        if (!open && !pending) onDismiss();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(`providers.overview.${action}.title`, { name: confirm?.connection.name ?? '' })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(`providers.overview.${action}.description`)}
            {isDefault && t(`providers.overview.${action}.defaultNote`)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t(`providers.overview.${action}.cancel`)}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              if (confirm) onConfirm(confirm);
            }}
          >
            {t(`providers.overview.${action}.confirm`)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
