import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MemoryUnit } from '@atd/agent-contracts';
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

/** Confirms deleting one memory, named by its name; open while `unit` is set. */
export function MemoryDeleteDialog({
  unit,
  onCancel,
  onConfirm,
}: {
  unit: MemoryUnit | null;
  onCancel: () => void;
  onConfirm: (unit: MemoryUnit) => void;
}) {
  const { t } = useTranslation('memory');
  // The dialog keeps naming the memory while it closes, after `unit` is cleared.
  const [shown, setShown] = useState(unit);
  if (unit && unit !== shown) setShown(unit);
  return (
    <AlertDialog
      open={Boolean(unit)}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('memory.confirm.deleteTitle', { name: shown?.name ?? '' })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('memory.confirm.deleteDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('memory.confirm.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (unit) onConfirm(unit);
            }}
          >
            {t('memory.confirm.deleteAction')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
