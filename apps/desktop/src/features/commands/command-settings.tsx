import { Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { Input } from '@ai/ui/components/input';
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
import type { CommandDefinition } from '../../../electron/agent/command-schema';
import { copyCommand, newCommand, personalCopy } from '../../../electron/agent/command-templates';
import type { SettingsSnapshot } from '../../../electron/settings-contract';
import { agentApi, useAgent } from '../agent/use-agent';
import { showErrorToast, showToast } from '../../components/toast-store';
import { CommandList } from './command-list';
import './commands.css';
import { SettingsHeading } from '../settings/settings-heading';
import { useSettingsSectionExit } from '../settings/settings-navigation';
import { lazyWithPreload } from '../../lib/lazy-with-preload';

// The editor brings CodeMirror; the settings window loads it once the command settings open, so
// opening a command for editing renders it at once.
const { Component: CommandEditor, preload: preloadCommandEditor } = lazyWithPreload(() =>
  import('./command-editor').then((module) => module.CommandEditor),
);

export function CommandSettings({
  settings,
  activeCommand,
  onConsumeActiveCommand,
}: {
  settings: SettingsSnapshot | null;
  activeCommand?: { id: string; nonce: number } | null;
  onConsumeActiveCommand?: () => void;
}) {
  const { t } = useTranslation('commands');
  const agent = useAgent();
  const [editing, setEditing] = useState<{ command: CommandDefinition; revision: number } | null>(
    null,
  );
  const [deleting, setDeleting] = useState<CommandDefinition | null>(null);
  const search = useCompositionQuery();
  const [pending, setPending] = useState<string | null>(null);
  useSettingsSectionExit(() => {
    setEditing(null);
    search.change('');
  });
  useEffect(() => {
    void preloadCommandEditor();
  }, []);
  async function change(command: CommandDefinition, enabled: boolean) {
    setPending(command.id);
    const status = enabled ? t('list.status.enabled') : t('list.status.disabled');
    try {
      await agentApi().saveCommand({ ...command, enabled }, command.revision);
      showToast({ kind: 'info', text: status });
    } catch (error) {
      showErrorToast(error);
    }
    setPending(null);
  }
  function edit(command: CommandDefinition) {
    setEditing({ command: structuredClone(command), revision: command.revision });
  }
  function duplicate(command: CommandDefinition) {
    const id = crypto.randomUUID();
    const names = (agent.snapshot?.commands ?? []).map((item) => item.name);
    setEditing({
      command: command.pluginId ? personalCopy(command, id, names) : copyCommand(command, id),
      revision: 0,
    });
  }
  if (editing)
    return (
      <Suspense>
        <CommandEditor
          key={editing.command.id}
          initial={editing.command}
          expectedRevision={editing.revision}
          settings={settings}
          tasks={agent.snapshot?.tasks ?? []}
          onCancel={() => setEditing(null)}
          onDuplicate={() => duplicate(editing.command)}
          onSaved={() => {
            setEditing(null);
            showToast({ kind: 'info', text: t('list.status.saved') });
          }}
        />
      </Suspense>
    );
  const commands = agent.snapshot?.commands ?? [];
  // A deep link (the task panel, a plugin's page) opens one command directly in the editor, which
  // is read-only for a plugin command. Derived during
  // render so a still-loading snapshot resolves to the editor once it arrives; the nonce remounts
  // the same command when requested again. An unknown id falls through to the list below.
  const linkedCommand = activeCommand
    ? (commands.find((command) => command.id === activeCommand.id) ?? null)
    : null;
  if (linkedCommand && activeCommand)
    return (
      <Suspense>
        <CommandEditor
          key={`${linkedCommand.id}-${activeCommand.nonce}`}
          initial={structuredClone(linkedCommand)}
          expectedRevision={linkedCommand.revision}
          settings={settings}
          tasks={agent.snapshot?.tasks ?? []}
          onCancel={() => onConsumeActiveCommand?.()}
          onDuplicate={() => {
            duplicate(linkedCommand);
            onConsumeActiveCommand?.();
          }}
          onSaved={() => {
            onConsumeActiveCommand?.();
            showToast({ kind: 'info', text: t('list.status.saved') });
          }}
        />
      </Suspense>
    );
  if (activeCommand && !agent.snapshot)
    return (
      <section className="command-settings">
        <output className="settings-loading">{t('list.loading')}</output>
      </section>
    );
  return (
    <section className="command-settings">
      <SettingsHeading title={t('list.title')} description={t('list.description')}>
        <Input
          aria-label={t('list.searchLabel')}
          placeholder={t('list.searchPlaceholder')}
          value={search.text}
          onChange={(event) => search.change(event.target.value)}
          {...search.compositionProps}
        />
        <Button
          disabled={!agent.snapshot}
          onClick={() => setEditing({ command: newCommand(crypto.randomUUID()), revision: 0 })}
        >
          <Plus />
          {t('list.new')}
        </Button>
      </SettingsHeading>
      <CommandList
        commands={commands}
        query={search.query}
        pending={pending !== null}
        shortcutErrors={agent.snapshot?.shortcutErrors ?? {}}
        onOpen={edit}
        onToggle={(command, enabled) => void change(command, enabled)}
        onDuplicate={duplicate}
        onDelete={setDeleting}
      />
      {commands.length === 0 &&
        (agent.snapshot ? (
          <p className="text-sm text-muted-foreground">{t('list.empty')}</p>
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
            <AlertDialogAction
              onClick={() => {
                if (deleting)
                  void agentApi()
                    .deleteCommand(deleting.id, deleting.revision)
                    .then(() => showToast({ kind: 'info', text: t('list.status.deleted') }))
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
