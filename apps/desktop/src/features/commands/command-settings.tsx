import { useState } from 'react';
import { Copy, MoreHorizontal, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
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
import type { CommandDefinition } from '../../../electron/agent/command-schema';
import { copyCommand, newCommand } from '../../../electron/agent/command-templates';
import type { SettingsSnapshot } from '../../../electron/settings-contract';
import { IconButton } from '../../components/icon-button';
import { shortcutKeys } from '../../lib/shortcuts';
import { agentApi, messageOf, useAgent } from '../agent/use-agent';
import { CommandEditor } from './command-editor';
import { CommandIcon } from './command-icon';
import './commands.css';
import { SettingsHeading } from '../settings/settings-heading';

export function CommandSettings({ settings }: { settings: SettingsSnapshot | null }) {
  const agent = useAgent();
  const [editing, setEditing] = useState<{ command: CommandDefinition; revision: number } | null>(
    null,
  );
  const [deleting, setDeleting] = useState<CommandDefinition | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  async function change(command: CommandDefinition, enabled: boolean) {
    setPending(command.id);
    setError('');
    try {
      await agentApi().saveCommand({ ...command, enabled }, command.revision);
      setStatus(enabled ? 'Command enabled.' : 'Command disabled.');
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setPending(null);
    }
  }
  function duplicate(command: CommandDefinition) {
    setEditing({
      command: copyCommand(command, crypto.randomUUID()),
      revision: 0,
    });
  }
  if (editing)
    return (
      <CommandEditor
        key={editing.command.id}
        initial={editing.command}
        expectedRevision={editing.revision}
        settings={settings}
        onCancel={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          setStatus('Command saved.');
        }}
      />
    );
  const commands = agent.snapshot?.commands ?? [];
  return (
    <section className="command-settings">
      <SettingsHeading
        title="Commands"
        description="Reusable instructions for the things you do often."
      >
        <Input
          aria-label="Search commands"
          placeholder="Search commands…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button
          disabled={!agent.snapshot}
          onClick={() => setEditing({ command: newCommand(crypto.randomUUID()), revision: 0 })}
        >
          <Plus />
          New
        </Button>
      </SettingsHeading>
      <ItemGroup>
        {commands
          .filter((command) =>
            `${command.name} ${command.description}`.toLowerCase().includes(search.toLowerCase()),
          )
          .map((command) => (
            <Item
              asChild
              size="sm"
              variant="outline"
              key={command.id}
              className="command-management-row hover:bg-muted/50"
            >
              <li>
                <div className="command-row-identity">
                  <ItemMedia variant="icon">
                    <CommandIcon templateId={command.templateId} />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle>{command.name}</ItemTitle>
                    <ItemDescription>{command.description}</ItemDescription>
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
                      <span className="text-xs text-muted-foreground">No shortcut</span>
                    )}
                  </div>
                  <ItemActions className="shrink-0">
                    <IconButton
                      label="Run"
                      aria-label={`Run ${command.name}`}
                      disabled={!command.enabled || pending !== null}
                      onClick={() => {
                        void agentApi()
                          .launch(command.id)
                          .catch((error) => setError(messageOf(error)));
                      }}
                    >
                      <Play />
                    </IconButton>
                    <Switch
                      aria-label={`Enable ${command.name}`}
                      checked={command.enabled}
                      disabled={pending !== null}
                      onCheckedChange={(enabled) => void change(command, enabled)}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton label="More" aria-label={`More actions for ${command.name}`}>
                          <MoreHorizontal />
                        </IconButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() =>
                            setEditing({
                              command: structuredClone(command),
                              revision: command.revision,
                            })
                          }
                        >
                          <Pencil />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => duplicate(command)}>
                          <Copy />
                          Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => setDeleting(command)}>
                          <Trash2 />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </ItemActions>
                </div>
              </li>
            </Item>
          ))}
      </ItemGroup>
      {commands.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {agent.snapshot ? 'No commands yet. Create your first command.' : 'Loading commands…'}
        </p>
      )}
      {(status || error || agent.error) && (
        <p
          role={error || agent.error ? 'alert' : 'status'}
          className="settings-status"
          data-error={Boolean(error || agent.error)}
        >
          {error || agent.error || status}
        </p>
      )}
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the command and its shortcut. Existing tasks keep their saved command
              version.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting)
                  void agentApi()
                    .deleteCommand(deleting.id, deleting.revision)
                    .then(() => setStatus('Command deleted.'))
                    .catch((error) => setError(messageOf(error)));
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
