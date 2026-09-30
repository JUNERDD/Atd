import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ai/ui/components/dialog';
import { ScrollArea } from '@ai/ui/components/scroll-area';

/**
 * One allowlist entry in full: its row shows a single truncated line, so a click on the row opens
 * this. Removing here is the same action as the row's trash button.
 */
export function ShellAllowlistEntryDialog({
  entry,
  open,
  onOpenChange,
  removing,
  onRemove,
}: {
  entry: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  removing: boolean;
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
        <DialogFooter>
          <Button variant="destructive" disabled={removing} onClick={onRemove}>
            <Trash2 />
            {t('permissions.shellAllowlist.remove')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
