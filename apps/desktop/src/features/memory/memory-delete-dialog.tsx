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
import type { MemoryEntry } from '../../client/agent/bridge';

/** Confirms deleting one memory; open while `entry` is set. */
export function MemoryDeleteDialog({
  entry,
  onCancel,
  onConfirm,
}: {
  entry: MemoryEntry | null;
  onCancel: () => void;
  onConfirm: (entry: MemoryEntry) => void;
}) {
  const { t } = useTranslation('memory');
  return (
    <AlertDialog
      open={Boolean(entry)}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('memory.confirm.deleteTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('memory.confirm.deleteDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('memory.confirm.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (entry) onConfirm(entry);
            }}
          >
            {t('memory.confirm.deleteAction')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
