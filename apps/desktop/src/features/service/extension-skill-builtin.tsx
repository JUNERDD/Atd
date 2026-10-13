import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@atd/ui/components/alert';
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
import { Button } from '@atd/ui/components/button';
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

/**
 * Tells the user that updates replaced their edited copies of built-in skills, one notice per
 * skill with where its copy was backed up. Dismissing one is saved by the service, for every
 * client; the backup itself stays.
 */
export function BuiltinBackupNotices({
  skills,
  disabled,
  onDismiss,
}: {
  skills: readonly { name: string; id: string; backupPath: string }[];
  disabled: boolean;
  onDismiss: (id: string) => void;
}) {
  const { t } = useTranslation('settings');
  return skills.map((skill) => (
    <Alert key={skill.id}>
      <RefreshCw />
      <AlertTitle>{t('extensions.builtinUpdatedTitle', { name: skill.name })}</AlertTitle>
      <AlertDescription className="wrap-anywhere select-text">
        {t('extensions.builtinUpdated', { path: skill.backupPath })}
      </AlertDescription>
      <AlertAction>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onDismiss(skill.id)}
        >
          {t('extensions.builtinUpdatedDismiss')}
        </Button>
      </AlertAction>
    </Alert>
  ));
}
