import { Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, MoreHorizontal, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { HighlightedText } from '@ai/ui/components/highlighted-text';
import { Input } from '@ai/ui/components/input';
import { Switch } from '@ai/ui/components/switch';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@ai/ui/components/item';
import { Kbd, KbdGroup } from '@ai/ui/components/kbd';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@ai/ui/components/dropdown-menu';
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
import { matchFields } from '@ai/ui/lib/fuzzy-match';
import { useCompositionQuery } from '@ai/ui/lib/ime';
import type { CommandDefinition } from '../../../electron/agent/command-schema';
import { copyCommand, newCommand } from '../../../electron/agent/command-templates';
import type { SettingsSnapshot } from '../../../electron/settings-contract';
import { IconButton } from '../../components/icon-button';
import { shortcutKeys } from '../../lib/shortcuts';
import { agentApi, useAgent } from '../agent/use-agent';
import { showErrorToast, showToast } from '../../components/toast-store';
import { CommandIcon } from './command-icon';
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
    setEditing({
      command: copyCommand(command, crypto.randomUUID()),
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
          onSaved={() => {
            setEditing(null);
            showToast({ kind: 'info', text: t('list.status.saved') });
          }}
        />
      </Suspense>
    );
  const commands = agent.snapshot?.commands ?? [];
  // A deep link from the task panel opens one command directly in the editor. Derived during
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
      <ItemGroup>
        {commands
          // Saved order stays; the search matches and marks the name and description rows show.
          .flatMap((command) => {
            const match = matchFields(search.query, {
              name: command.name,
              description: command.description,
            });
            return match || !search.query.trim() ? [{ command, match }] : [];
          })
          .map(({ command, match }) => (
            <Item
              asChild
              size="sm"
              variant="outline"
              key={command.id}
              className="command-management-row settings-open-row"
            >
              <li>
                {/* A click anywhere on the row opens the editor, like the memory and skill rows;
                    the run, enable and More controls stay interactive above this button. */}
                <button
                  type="button"
                  className="settings-open-row-button"
                  aria-label={t('list.editFor', { name: command.name })}
                  onClick={() => edit(command)}
                />
                <div className="command-row-identity">
                  <ItemMedia variant="icon">
                    <CommandIcon templateId={command.templateId} />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle>
                      <HighlightedText text={command.name} ranges={match?.ranges.name} />
                    </ItemTitle>
                    <ItemDescription>
                      <HighlightedText
                        text={command.description}
                        ranges={match?.ranges.description}
                      />
                    </ItemDescription>
                    {agent.snapshot?.shortcutErrors[command.id] && (
                      <p className="text-xs text-destructive">
                        {agent.snapshot.shortcutErrors[command.id]}
                      </p>
                    )}
                  </ItemContent>
                </div>
                <div className="command-row-controls">
                  <div className="command-row-shortcut">
                    {command.shortcut ? (
                      <KbdGroup>
                        {shortcutKeys(command.shortcut, window.desktop?.platform ?? 'web').map(
                          (key) => (
                            <Kbd key={key}>{key}</Kbd>
                          ),
                        )}
                      </KbdGroup>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t('list.noShortcut')}</span>
                    )}
                  </div>
                  <ItemActions className="shrink-0">
                    <IconButton
                      label={t('list.run')}
                      aria-label={t('list.runFor', { name: command.name })}
                      disabled={!command.enabled || pending !== null}
                      onClick={() => {
                        void agentApi()
                          .launch(command.id)
                          .catch((error) => showErrorToast(error));
                      }}
                    >
                      <Play />
                    </IconButton>
                    <Switch
                      aria-label={t('list.enableFor', { name: command.name })}
                      checked={command.enabled}
                      disabled={pending !== null}
                      onCheckedChange={(enabled) => void change(command, enabled)}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton
                          label={t('list.more')}
                          aria-label={t('list.moreActionsFor', { name: command.name })}
                          tooltipDismissOnClick
                        >
                          <MoreHorizontal />
                        </IconButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => edit(command)}>
                          <Pencil />
                          {t('common.edit')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => duplicate(command)}>
                          <Copy />
                          {t('list.duplicate')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => setDeleting(command)}>
                          <Trash2 />
                          {t('common.delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </ItemActions>
                </div>
              </li>
            </Item>
          ))}
      </ItemGroup>
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
