import { CircleAlert, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@atd/ui/components/dialog';
import { ScrollArea } from '@atd/ui/components/scroll-area';

/**
 * One allowlist entry in full: its row shows a single truncated line, so a click on the row opens
 * this. Removing here is the same action as the row's trash button; a failed removal is reported
 * here, where it was asked for.
 */
export function ShellAllowlistEntryDialog({
  entry,
  open,
  onOpenChange,
  unavailable,
  removing,
  error,
  onRemove,
}: {
  entry: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The list cannot change at all, such as without the desktop bridge. */
  unavailable: boolean;
  /** A save is in flight: Remove stays focusable and ignores clicks until it settles. */
  removing: boolean;
  error?: string | undefined;
  onRemove: () => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="panel-dialog">
        <DialogHeader>
          <DialogTitle>{t('permissions.shellAllowlist.detailTitle')}</DialogTitle>
          <DialogDescription className="whitespace-normal">
            {t('permissions.shellAllowlist.detailDescription')}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="settings-shell-allowlist-detail" scrollShadow>
          <pre className="font-mono">
            <span className="settings-shell-allowlist-prompt" aria-hidden="true">
              ${' '}
            </span>
            {entry}
          </pre>
        </ScrollArea>
        {error && (
          <p className="settings-inline-error" role="alert">
            <CircleAlert aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}
        <DialogFooter>
          <Button
            variant="destructive"
            disabled={unavailable}
            aria-disabled={removing || undefined}
            aria-busy={removing || undefined}
            onClick={() => {
              if (!removing) onRemove();
            }}
          >
            <Trash2 />
            {t('permissions.shellAllowlist.remove')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
