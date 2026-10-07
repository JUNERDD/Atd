import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_NAME_MAX_LENGTH } from '@atd/agent-contracts';
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
import { Button } from '@atd/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@atd/ui/components/dialog';
import { Input } from '@atd/ui/components/input';
import { Label } from '@atd/ui/components/label';
import { isComposingKey } from '@atd/ui/lib/ime';

/** A destructive or data-changing app action waiting for the user's confirmation. */
export interface AppConfirmation {
  title: string;
  description: string;
  action: string;
  /** Delete and Clear data read as destructive; Restore keeps the default action style. */
  destructive: boolean;
  onConfirm: () => void;
}

/**
 * Confirms one app action; open while `confirmation` is set. The last confirmation stays
 * rendered while the dialog closes, so the exit animation keeps its copy.
 */
export function AppConfirmDialog({
  confirmation,
  onClose,
}: {
  confirmation: AppConfirmation | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('apps');
  const [shown, setShown] = useState(confirmation);
  if (confirmation && confirmation !== shown) setShown(confirmation);
  return (
    <AlertDialog
      open={confirmation !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="wrap-anywhere">{shown?.title}</AlertDialogTitle>
          <AlertDialogDescription>{shown?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('confirm.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant={shown?.destructive ? 'destructive' : 'default'}
            onClick={() => shown?.onConfirm()}
          >
            {shown?.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Renames one app; open while `app` is set, starting from its current name each time. `onSave`
 * resolves whether the rename landed, which closes the dialog.
 */
export function RenameAppDialog({
  app,
  onClose,
  onSave,
}: {
  app: { id: string; name: string } | null;
  onClose: () => void;
  onSave: (appId: string, name: string) => Promise<boolean>;
}) {
  const { t } = useTranslation('apps');
  const [shown, setShown] = useState(app);
  const [name, setName] = useState(app?.name ?? '');
  const [saving, setSaving] = useState(false);
  if (app && app !== shown) {
    setShown(app);
    setName(app.name);
  }
  const trimmed = name.trim();
  const valid = trimmed.length > 0 && trimmed !== shown?.name;

  async function save() {
    if (!shown || !valid || saving) return;
    setSaving(true);
    const saved = await onSave(shown.id, trimmed);
    setSaving(false);
    if (saved) onClose();
  }

  return (
    <Dialog
      open={app !== null}
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="panel-dialog">
        <DialogHeader>
          <DialogTitle>{t('rename.title')}</DialogTitle>
          <DialogDescription>{t('rename.description')}</DialogDescription>
        </DialogHeader>
        <div className="settings-field">
          <Label htmlFor="app-name">{t('rename.label')}</Label>
          <Input
            id="app-name"
            value={name}
            maxLength={APP_NAME_MAX_LENGTH}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !isComposingKey(event)) void save();
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            {t('rename.cancel')}
          </Button>
          <Button disabled={!valid || saving} onClick={() => void save()}>
            {t('rename.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
