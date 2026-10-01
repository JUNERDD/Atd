import { useState } from 'react';
import { Trash2 } from 'lucide-react';
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
} from '@ai/ui/components/alert-dialog';
import { Button } from '@ai/ui/components/button';

/**
 * Confirms removing one Personal skill, subagent or MCP server. The caller names the item and says
 * what removing it does, since a server only leaves the catalog while skill and subagent files are
 * deleted from disk.
 */
export function ExtensionRemoveDialog({
  name,
  title,
  description,
  confirm,
  onCancel,
  onConfirm,
}: {
  /** The item being removed; null keeps the dialog closed. */
  name: string | null;
  title: string;
  description: string;
  confirm: string;
  onCancel: () => void;
  onConfirm: (name: string) => void;
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
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('extensions.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (name !== null) onConfirm(name);
            }}
          >
            {confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * A details page's footer control for removing its Personal item: the button opens the same
 * confirmation the row's More menu does, and `onConfirm` runs only once it is confirmed.
 */
export function ExtensionRemoveButton({
  name,
  label,
  title,
  description,
  disabled,
  onConfirm,
}: {
  name: string;
  /** The button's and the confirmation's action label, such as Delete or Remove. */
  label: string;
  title: string;
  description: string;
  disabled: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="glass" disabled={disabled} onClick={() => setOpen(true)}>
        <Trash2 data-icon="inline-start" />
        {label}
      </Button>
      <ExtensionRemoveDialog
        name={open ? name : null}
        title={title}
        description={description}
        confirm={label}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);
          onConfirm();
        }}
      />
    </>
  );
}
