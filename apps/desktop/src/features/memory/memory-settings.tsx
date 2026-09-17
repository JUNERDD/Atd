import { useEffect, useRef, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Input } from '@ai/ui/components/input';
import { Label } from '@ai/ui/components/label';
import { Switch } from '@ai/ui/components/switch';
import { Textarea } from '@ai/ui/components/textarea';
import { ScrollArea } from '@ai/ui/components/scroll-area';
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
import type { MemoryEntry, MemorySnapshot } from '../../../electron/agent/bridge';
import { SettingsHeading } from '../settings/settings-heading';
import { IconButton } from '../../components/icon-button';
import { agentApi } from '../agent/use-agent';
import { showErrorToast } from '../../components/toast-store';

export function MemorySettings() {
  const { t } = useTranslation('memory');
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<MemoryEntry | null>(null);
  const [content, setContent] = useState('');
  const [confirm, setConfirm] = useState<'pause' | 'delete' | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const errorMessage = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (editing && error) errorMessage.current?.scrollIntoView({ block: 'nearest' });
  }, [editing, error]);
  useEffect(() => {
    let active = true;
    if (!window.desktop?.agent) return;
    const off = window.desktop.agent.onChange((event) => {
      if (event.type === 'memory') setSnapshot(event.snapshot);
    });
    void window.desktop.agent.memory().then(
      (value) => {
        if (active) setSnapshot(value);
      },
      (error) => {
        if (active) showErrorToast(error);
      },
    );
    return () => {
      active = false;
      off();
    };
  }, []);
  async function pause(paused: boolean) {
    setPending(true);
    setError('');
    try {
      setSnapshot(await agentApi().pauseMemory(paused));
      setStatus(paused ? t('memory.feedback.paused') : t('memory.feedback.resumed'));
    } catch (error) {
      showErrorToast(error);
    } finally {
      setPending(false);
    }
  }
  async function save(remove = false) {
    if (!editing) return;
    if (!remove && !content.trim()) {
      setError(t('memory.feedback.emptyContent'));
      return;
    }
    setPending(true);
    setError('');
    try {
      setSnapshot(await agentApi().updateMemory(editing, remove ? '' : content));
      setEditing(null);
      setStatus(remove ? t('memory.feedback.deleted') : t('memory.feedback.updated'));
    } catch (error) {
      showErrorToast(error);
    } finally {
      setPending(false);
    }
  }
  function closeEditor() {
    setEditing(null);
    setError('');
    setStatus('');
  }
  const failure = error || snapshot?.error;
  const feedback = (
    <>
      {(failure || status) && (
        <p
          id="memory-feedback"
          ref={errorMessage}
          className="settings-status"
          data-error={Boolean(failure)}
          role={failure ? 'alert' : 'status'}
        >
          {failure || status}
        </p>
      )}
      {failure && (!editing || Boolean(snapshot?.error)) && (
        <Button
          variant="outline"
          className="mt-3"
          onClick={() => {
            void agentApi()
              .memory()
              .then((value) => {
                setSnapshot(value);
                setError('');
              })
              .catch((error) => showErrorToast(error));
          }}
        >
          {t('memory.feedback.reload')}
        </Button>
      )}
    </>
  );
  return (
    <section className="memory-settings">
      {editing ? (
        <div className="command-editor">
          <SettingsHeading
            title={t('memory.edit.title')}
            onBack={closeEditor}
            backLabel={t('memory.edit.back')}
          />
          <ScrollArea className="editor-fields" gutter>
            <div className="settings-editor-inner">
              <div className="settings-field">
                <Label htmlFor="memory-content">{t('memory.edit.fieldLabel')}</Label>
                <Textarea
                  id="memory-content"
                  rows={6}
                  maxLength={20000}
                  value={content}
                  aria-invalid={Boolean(error) && !content.trim()}
                  aria-describedby={failure ? 'memory-feedback' : undefined}
                  onChange={(event) => {
                    setContent(event.target.value);
                    setError('');
                  }}
                />
                <p className="text-xs text-muted-foreground">{t('memory.edit.note')}</p>
              </div>
              {feedback}
            </div>
          </ScrollArea>
          <footer className="editor-footer">
            <Button variant="ghost" onClick={() => setConfirm('delete')} disabled={pending}>
              <Trash2 />
              {t('memory.edit.delete')}
            </Button>
            <div>
              <Button variant="outline" onClick={closeEditor} disabled={pending}>
                {t('memory.edit.cancel')}
              </Button>
              <Button onClick={() => void save()} disabled={pending}>
                {pending ? t('memory.edit.saving') : t('memory.edit.save')}
              </Button>
            </div>
          </footer>
        </div>
      ) : (
        <>
          <SettingsHeading title={t('memory.title')} description={t('memory.description')}>
            <Input
              aria-label={t('memory.searchLabel')}
              placeholder={t('memory.searchPlaceholder')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </SettingsHeading>
          <div className="flex items-center justify-between gap-4 mb-6">
            <div className="settings-field">
              <Label htmlFor="memory-learning">{t('memory.learning.label')}</Label>
              <p
                className="text-xs text-muted-foreground truncate"
                title={t('memory.learning.description')}
              >
                {t('memory.learning.description')}
              </p>
            </div>
            <Switch
              id="memory-learning"
              checked={snapshot ? !snapshot.paused : false}
              disabled={!snapshot || pending || Boolean(snapshot.error)}
              onCheckedChange={(checked) => {
                if (checked) void pause(false);
                else setConfirm('pause');
              }}
            />
          </div>
          <ul className="memory-items">
            {snapshot?.entries
              .filter((entry) => entry.content.toLowerCase().includes(search.toLowerCase()))
              .map((entry) => (
                <li key={entry.id} className="memory-item">
                  <div>
                    <p>{entry.content}</p>
                    <span>
                      {entry.target === 'user'
                        ? t('memory.list.userProfile')
                        : entry.target === 'failure'
                          ? t('memory.list.corrections')
                          : t('memory.list.preference')}
                    </span>
                  </div>
                  <IconButton
                    label={t('memory.list.edit')}
                    aria-label={t('memory.list.editLabel', { content: entry.content.slice(0, 70) })}
                    onClick={() => {
                      setEditing(entry);
                      setContent(entry.content);
                      setError('');
                      setStatus('');
                    }}
                  >
                    <Pencil />
                  </IconButton>
                </li>
              ))}
          </ul>
          {!snapshot && <p className="text-sm text-muted-foreground">{t('memory.list.loading')}</p>}
          {snapshot && !snapshot.entries.length && !snapshot.error && (
            <p className="text-sm text-muted-foreground">{t('memory.list.empty')}</p>
          )}
          {snapshot &&
            snapshot.entries.length > 0 &&
            !snapshot.entries.some((entry) =>
              entry.content.toLowerCase().includes(search.toLowerCase()),
            ) && <p className="text-sm text-muted-foreground">{t('memory.list.noMatches')}</p>}
          <p className="text-xs text-muted-foreground mt-8">{t('memory.feedback.storageNote')}</p>
          {feedback}
        </>
      )}
      <AlertDialog
        open={Boolean(confirm)}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === 'pause'
                ? t('memory.confirm.pauseTitle')
                : t('memory.confirm.deleteTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'pause'
                ? t('memory.confirm.pauseDescription')
                : t('memory.confirm.deleteDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('memory.confirm.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm === 'pause') void pause(true);
                else void save(true);
              }}
            >
              {confirm === 'pause'
                ? t('memory.confirm.pauseAction')
                : t('memory.confirm.deleteAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
