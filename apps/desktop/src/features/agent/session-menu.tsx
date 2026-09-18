import { useState, type ReactElement } from 'react';
import { Link2, Pencil, Ellipsis } from 'lucide-react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@ai/ui/components/dropdown-menu';
import { Input } from '@ai/ui/components/input';
import { Label } from '@ai/ui/components/label';
import type { AgentTask } from '../../../electron/agent/task-schema';
import { IconButton } from '../../components/icon-button';
import { showErrorToast, showToast } from '../../components/toast-store';
import { agentApi } from './use-agent';
import { sessionLinkText } from './session-link';

const TITLE_LIMIT = 120;

export function SessionMenu({ task }: { task: AgentTask }): ReactElement {
  const { t } = useTranslation('panel');
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState(task.title);
  const [saving, setSaving] = useState(false);
  const trimmed = name.trim();
  const unchanged = trimmed === task.title.trim();
  const invalid = trimmed.length === 0 || trimmed.length > TITLE_LIMIT || unchanged;

  async function copyLink() {
    try {
      const { text, withSession } = sessionLinkText(task);
      await agentApi().copy(text);
      showToast({
        kind: 'info',
        text: withSession ? t('session.linkCopied') : t('session.idCopied'),
      });
    } catch (error) {
      showErrorToast(error);
    }
  }

  function openRename() {
    setName(task.title);
    setRenameOpen(true);
  }

  async function saveRename() {
    if (invalid || saving) return;
    setSaving(true);
    try {
      await agentApi().renameTask(task.id, trimmed);
      showToast({ kind: 'info', text: t('session.renamed') });
      setRenameOpen(false);
    } catch (error) {
      showErrorToast(error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            label={t('session.menu')}
            aria-label={t('session.menu')}
            className="header-button"
          >
            <Ellipsis />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="center">
          <DropdownMenuItem onSelect={openRename}>
            <Pencil />
            {t('session.rename')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void copyLink()}>
            <Link2 />
            {t('session.copyLink')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={renameOpen}
        onOpenChange={(open) => {
          if (!saving) setRenameOpen(open);
        }}
      >
        <DialogContent className="panel-dialog">
          <DialogHeader>
            <DialogTitle>{t('session.renameTitle')}</DialogTitle>
            <DialogDescription>{t('session.renameDescription')}</DialogDescription>
          </DialogHeader>
          <div className="settings-field">
            <Label htmlFor="session-name">{t('session.renameLabel')}</Label>
            <Input
              id="session-name"
              value={name}
              maxLength={TITLE_LIMIT}
              placeholder={t('session.renamePlaceholder')}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) void saveRename();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setRenameOpen(false)}>
              {t('session.renameCancel')}
            </Button>
            <Button disabled={invalid || saving} onClick={() => void saveRename()}>
              {t('session.renameSave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
