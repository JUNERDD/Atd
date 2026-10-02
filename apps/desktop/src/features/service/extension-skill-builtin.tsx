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
import { Badge } from '@atd/ui/components/badge';
import type { ExtensionBuiltin } from './extension-rows';

/**
 * Marks a built-in skill whose copy differs from what ships with the app: a newer shipped version
 * reads as a compact badge, a user edit without one as muted text. A current copy shows nothing.
 */
export function SkillBuiltinStatus({ status }: { status: ExtensionBuiltin['status'] }) {
  const { t } = useTranslation('settings');
  switch (status) {
    case 'current':
      return null;
    case 'modified':
      return (
        <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
          {t('extensions.builtinModified')}
        </span>
      );
    case 'update_available':
      return <Badge variant="secondary">{t('extensions.builtinUpdateAvailable')}</Badge>;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

/** Confirms replacing the user's copy of a built-in skill; the service backs that copy up first. */
export function RestoreBuiltinDialog({
  name,
  onCancel,
  onConfirm,
}: {
  /** The skill being restored; null keeps the dialog closed. */
  name: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <AlertDialog
      open={name !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('extensions.restoreTitle', { name: name ?? '' })}</AlertDialogTitle>
          <AlertDialogDescription>{t('extensions.restoreDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('extensions.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {t('extensions.restoreConfirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
