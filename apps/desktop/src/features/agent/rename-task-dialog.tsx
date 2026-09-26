import { useState, type ReactElement } from 'react';
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
import { Input } from '@ai/ui/components/input';
import { Label } from '@ai/ui/components/label';
import type { AgentTask } from '../../../electron/agent/task-schema';
import { showErrorToast, showToast } from '../../components/toast-store';
import { agentApi } from './use-agent';

const TITLE_LIMIT = 120;

/** Rename form for one task; the name resets to the task's current title each time it opens. */
export function RenameTaskDialog({
  task,
  open,
  onOpenChange,
}: {
  task: AgentTask;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const { t } = useTranslation('panel');
  const [name, setName] = useState(task.title);
  const [wasOpen, setWasOpen] = useState(open);
  const [saving, setSaving] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setName(task.title);
  }
  const trimmed = name.trim();
  const unchanged = trimmed === task.title.trim();
  const invalid = trimmed.length === 0 || trimmed.length > TITLE_LIMIT || unchanged;

  async function save() {
    if (invalid || saving) return;
    setSaving(true);
    try {
      await agentApi().renameTask(task.id, trimmed);
      showToast({ kind: 'info', text: t('session.renamed') });
      onOpenChange(false);
    } catch (error) {
      showErrorToast(error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next);
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
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) void save();
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            {t('session.renameCancel')}
          </Button>
          <Button disabled={invalid || saving} onClick={() => void save()}>
            {t('session.renameSave')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
