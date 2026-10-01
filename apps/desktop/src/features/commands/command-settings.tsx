import { Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Command, Plus } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@ai/ui/components/empty';
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
import { useCompositionQuery } from '@ai/ui/lib/ime';
import type { CommandDefinition } from '../../client/agent/command-schema';
import { copyCommand, newCommand, personalCopy } from '../../client/agent/command-templates';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { agentApi, useAgent } from '../agent/use-agent';
import { showErrorToast, showToast } from '../../components/toast-store';
import { CommandList } from './command-list';
import './commands.css';
import { SettingsHeading } from '../settings/settings-heading';
import { SettingsSearchField } from '../settings/settings-search-field';
import { useSettingsSectionExit } from '../settings/settings-navigation';
import { useSettingsPageHistory } from '../settings/use-settings-page-history';
import { lazyWithPreload } from '../../lib/lazy-with-preload';

// The editor brings CodeMirror; the settings window loads it once the command settings open, so
// opening a command for editing renders it at once.
const { Component: CommandEditor, preload: preloadCommandEditor } = lazyWithPreload(() =>
  import('./command-editor').then((module) => module.CommandEditor),
);

/**
 * An editor page of the Commands section: a saved command's (read-only for a plugin's), where
 * `nonce` tells repeated deep links apart, or a new or duplicated command's until it is saved.
 */
type EditorRoute =
  | { page: 'command'; id: string; nonce?: number }
  | { page: 'draft'; command: CommandDefinition };
/** A page of the Commands section: the list, an editor, or a parameter's page over its editor. */
type CommandRoute =
  | { page: 'list' }
  | EditorRoute
  | { page: 'parameter'; editor: EditorRoute; key: string | null };
const LIST: CommandRoute = { page: 'list' };

function editorOf(route: CommandRoute): EditorRoute | null {
  if (route.page === 'list') return null;
  return route.page === 'parameter' ? route.editor : route;
}

export function CommandSettings({
  settings,
  activeCommand,
}: {
  settings: SettingsSnapshot | null;
  /** The latest deep link (the task panel, a plugin's page); each new nonce opens its editor. */
  activeCommand?: { id: string; nonce: number } | null;
}) {
  const { t } = useTranslation('commands');
  const agent = useAgent();
  const commands = agent.snapshot?.commands ?? [];
  const history = useSettingsPageHistory<CommandRoute>(LIST, (route) => {
    const editor = editorOf(route);
    return (
      editor?.page !== 'command' ||
      !agent.snapshot ||
      commands.some((command) => command.id === editor.id)
    );
  });
  const [deleting, setDeleting] = useState<CommandDefinition | null>(null);
  const search = useCompositionQuery();
  const searchInput = useRef<HTMLInputElement>(null);
  // Every command with a save in flight: each row waits for its own save, not for the others'.
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  function track(id: string, busy: boolean) {
    setPending((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  useSettingsSectionExit(() => search.change(''));
  // A deep link opens its editor as a page of the history, once per request.
  const [linked, setLinked] = useState<number | null>(null);
  if (activeCommand && activeCommand.nonce !== linked) {
    setLinked(activeCommand.nonce);
    history.open({ page: 'command', id: activeCommand.id, nonce: activeCommand.nonce });
  }
  useEffect(() => {
    void preloadCommandEditor();
  }, []);
  // The switch flipping is the feedback; only a failure needs a message.
  async function change(command: CommandDefinition, enabled: boolean) {
    track(command.id, true);
    try {
      await agentApi().saveCommand({ ...command, enabled }, command.revision);
    } catch (error) {
      showErrorToast(error);
    } finally {
      track(command.id, false);
    }
  }
  function duplicate(command: CommandDefinition) {
    const id = crypto.randomUUID();
    const names = commands.map((item) => item.name);
    history.open({
      page: 'draft',
      command: command.pluginId ? personalCopy(command, id, names) : copyCommand(command, id),
    });
  }
  const create = () => history.open({ page: 'draft', command: newCommand(crypto.randomUUID()) });
  const { route } = history;
  const editor = editorOf(route);
  const saved = editor?.page === 'command' ? commands.find((item) => item.id === editor.id) : null;
  const opened =
    editor?.page === 'draft'
      ? { command: editor.command, revision: 0 }
      : saved
        ? { command: structuredClone(saved), revision: saved.revision }
        : null;
  if (editor && opened)
    return (
      <Suspense>
        <CommandEditor
          key={
            editor.page === 'draft'
              ? `draft-${editor.command.id}`
              : `${editor.id}-${editor.nonce ?? ''}`
          }
          initial={opened.command}
          expectedRevision={opened.revision}
          settings={settings}
          tasks={agent.snapshot?.tasks ?? []}
          parameterPage={{
            shown: route.page === 'parameter' ? { key: route.key } : null,
            open: (key) => history.open({ page: 'parameter', editor, key }),
            close: (key) => {
              // A saved parameter leaves without the unsaved-changes question; Cancel asks.
              if (key === undefined) {
                history.back();
                return;
              }
              const saved: CommandRoute = { page: 'parameter', editor, key };
              history.replace(saved);
              history.leave(saved);
            },
            discard: history.discard,
          }}
          onCancel={history.back}
          onDuplicate={() => duplicate(opened.command)}
          onSaved={() => {
            // A saved draft becomes its command, which Forward then reopens.
            if (editor.page === 'draft') {
              const command: CommandRoute = { page: 'command', id: editor.command.id };
              history.replace(command, editor);
              history.leave(command);
            } else history.leave(editor);
            showToast({ kind: 'info', text: t('list.status.saved') });
          }}
        />
      </Suspense>
    );
  if (editor && !agent.snapshot)
    return (
      <section className="command-settings">
        <output className="settings-loading">{t('list.loading')}</output>
      </section>
    );
  // A deep link to an unknown id, or a command deleted meanwhile, falls back to the list.
  if (editor) history.discard();
  return (
    <section className="command-settings">
      <SettingsHeading title={t('list.title')} description={t('list.description')}>
        <SettingsSearchField
          search={search}
          ref={searchInput}
          aria-label={t('list.searchLabel')}
          placeholder={t('list.searchPlaceholder')}
        />
        <Button disabled={!agent.snapshot} onClick={create}>
          <Plus />
          {t('list.new')}
        </Button>
      </SettingsHeading>
      <CommandList
        commands={commands}
        query={search.query}
        pendingIds={pending}
        shortcutErrors={agent.snapshot?.shortcutErrors ?? {}}
        onClearSearch={() => {
          search.change('');
          searchInput.current?.focus();
        }}
        onOpen={(command) => history.open({ page: 'command', id: command.id })}
        onToggle={(command, enabled) => void change(command, enabled)}
        onDuplicate={duplicate}
        onDelete={setDeleting}
      />
      {commands.length === 0 &&
        (agent.snapshot ? (
          <div className="settings-extension-empty">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Command />
                </EmptyMedia>
                <EmptyTitle>{t('list.emptyTitle')}</EmptyTitle>
                <EmptyDescription>{t('list.emptyDescription')}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={create}>
                  <Plus />
                  {t('list.new')}
                </Button>
              </EmptyContent>
            </Empty>
          </div>
        ) : (
          <output className="settings-loading">{t('list.loading')}</output>
        ))}
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('list.deleteTitle', { name: deleting?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('list.deleteDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            {/* The row leaving the list confirms the deletion; only a failure needs a message. */}
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleting)
                  void agentApi()
                    .deleteCommand(deleting.id, deleting.revision)
                    .catch((error) => showErrorToast(error));
              }}
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
