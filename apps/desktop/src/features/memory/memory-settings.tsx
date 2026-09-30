import { useEffect, useRef, useState } from 'react';
import { CircleAlert, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Input } from '@ai/ui/components/input';
import { useCompositionQuery } from '@ai/ui/lib/ime';
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
import type { MemoryEntry, MemorySnapshot } from '../../client/agent/bridge';
import { FieldHint } from '../../components/field-hint';
import { SettingsHeading } from '../settings/settings-heading';
import { agentApi } from '../agent/use-agent';
import { showErrorToast, showToast } from '../../components/toast-store';
import { useOverlayFooter } from '../../components/use-overlay-footer';
import { MemoryCreateButton } from './memory-create-button';
import { MemoryList } from './memory-list';
import { useSettingsSectionExit } from '../settings/settings-navigation';
import { useSettingsPageHistory } from '../settings/use-settings-page-history';

type Confirm = { kind: 'pause' } | { kind: 'delete'; entry: MemoryEntry };
/** A page of the Memory section: the list, or one entry's editor. */
type MemoryRoute = { page: 'list' } | { page: 'edit'; entry: MemoryEntry };
const LIST: MemoryRoute = { page: 'list' };

export function MemorySettings() {
  const { t } = useTranslation('memory');
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null);
  const search = useCompositionQuery();
  const history = useSettingsPageHistory<MemoryRoute>(
    LIST,
    (route) =>
      route.page === 'list' ||
      !snapshot ||
      snapshot.entries.some(({ id }) => id === route.entry.id),
  );
  const { route } = history;
  // The entry as the latest snapshot has it; one removed meanwhile stays as the editor opened it.
  const editing =
    route.page === 'edit'
      ? (snapshot?.entries.find(({ id }) => id === route.entry.id) ?? route.entry)
      : null;
  const [content, setContent] = useState('');
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useSettingsSectionExit(() => {
    setError('');
    search.change('');
  });
  // Every page shown, including one Forward reopens, starts from the entry's saved content.
  const [shownRoute, setShownRoute] = useState(route);
  if (shownRoute !== route) {
    setShownRoute(route);
    setContent(editing?.content ?? '');
    setError('');
  }
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const footerRef = useOverlayFooter<HTMLElement>();
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
    const feedback = paused ? t('memory.feedback.paused') : t('memory.feedback.resumed');
    try {
      setSnapshot(await agentApi().pauseMemory(paused));
      showToast({ kind: 'info', text: feedback });
    } catch (error) {
      showErrorToast(error);
    }
    setPending(false);
  }
  /** Saves `entry` with new content; empty content deletes it. Either way the editor closes. */
  async function update(entry: MemoryEntry, next: string) {
    const from = route;
    setPending(true);
    setError('');
    const feedback = next ? t('memory.feedback.updated') : t('memory.feedback.deleted');
    try {
      setSnapshot(await agentApi().updateMemory(entry, next));
      history.leave(from);
      showToast({ kind: 'info', text: feedback });
    } catch (error) {
      showErrorToast(error);
    }
    setPending(false);
  }
  function save() {
    if (!editing) return;
    if (!content.trim()) setError(t('memory.feedback.emptyContent'));
    else void update(editing, content);
  }
  const failure = error || snapshot?.error;
  const feedback = (
    <>
      {failure && (
        <p
          id="memory-feedback"
          ref={errorMessage}
          className="settings-status"
          data-error="true"
          role="alert"
        >
          {failure}
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
            subpage
            backLabel={t('memory.edit.back')}
          />
          <ScrollArea
            className="editor-fields"
            viewportClassName="overlay-footer-fade"
            gutter="stable"
          >
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
          <footer ref={footerRef} className="editor-footer overlay-footer">
            <Button
              variant="glass"
              onClick={() => setConfirm({ kind: 'delete', entry: editing })}
              disabled={pending}
            >
              <Trash2 />
              {t('memory.edit.delete')}
            </Button>
            <div>
              <Button variant="glass" onClick={history.back} disabled={pending}>
                {t('memory.edit.cancel')}
              </Button>
              <Button onClick={save} disabled={pending}>
                {pending ? t('memory.edit.saving') : t('memory.edit.save')}
              </Button>
            </div>
          </footer>
        </div>
      ) : (
        <>
          <SettingsHeading
            title={t('memory.title')}
            titleHint={
              <FieldHint
                text={t('memory.feedback.storageNote')}
                side="bottom"
                icon={<CircleAlert className="size-4" />}
              />
            }
            description={t('memory.description')}
          >
            <Input
              aria-label={t('memory.searchLabel')}
              placeholder={t('memory.searchPlaceholder')}
              value={search.text}
              disabled={!snapshot?.entries.length}
              onChange={(event) => search.change(event.target.value)}
              {...search.compositionProps}
            />
            <MemoryCreateButton
              paused={Boolean(snapshot?.paused)}
              unavailable={!snapshot || Boolean(snapshot.error)}
            />
          </SettingsHeading>
          {/* The panel owns the scrollbar; the heading and search stay put above it. */}
          <ScrollArea
            className="mt-4 flex-1"
            viewportClassName="[&>div]:flex! [&>div]:flex-col [&>div]:min-h-full"
            gutter="stable"
            scrollShadow
          >
            <div className="memory-list">
              {/* A setting, not a memory: a plain switch row, unlike the list rows below it. */}
              <div className="memory-learning">
                <div className="min-w-0">
                  <Label htmlFor="memory-learning">{t('memory.learning.label')}</Label>
                  <p
                    className="truncate text-xs text-muted-foreground"
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
                    else setConfirm({ kind: 'pause' });
                  }}
                />
              </div>
              {snapshot ? (
                snapshot.error && !snapshot.entries.length ? null : (
                  <MemoryList
                    entries={snapshot.entries}
                    query={search.query}
                    empty={
                      snapshot.entries.length ? t('memory.list.noMatches') : t('memory.list.empty')
                    }
                    disabled={pending}
                    onEdit={(entry) => history.open({ page: 'edit', entry })}
                    onDelete={(entry) => setConfirm({ kind: 'delete', entry })}
                  />
                )
              ) : (
                <p className="text-sm text-muted-foreground">{t('memory.list.loading')}</p>
              )}
              {feedback}
            </div>
          </ScrollArea>
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
              {confirm?.kind === 'pause'
                ? t('memory.confirm.pauseTitle')
                : t('memory.confirm.deleteTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === 'pause'
                ? t('memory.confirm.pauseDescription')
                : t('memory.confirm.deleteDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('memory.confirm.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm?.kind === 'pause') void pause(true);
                else if (confirm) void update(confirm.entry, '');
              }}
            >
              {confirm?.kind === 'pause'
                ? t('memory.confirm.pauseAction')
                : t('memory.confirm.deleteAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
