import { useTranslation } from 'react-i18next';
import { Copy, KeyboardOff, MoreHorizontal, Pencil, Play, SearchX, Trash2 } from 'lucide-react';
import { Button } from '@atd/ui/components/button';
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@atd/ui/components/empty';
import { HighlightedText } from '@atd/ui/components/highlighted-text';
import { Switch } from '@atd/ui/components/switch';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@atd/ui/components/item';
import { Kbd, KbdGroup } from '@atd/ui/components/kbd';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@atd/ui/components/dropdown-menu';
import { matchFields, type FieldsMatch } from '@atd/ui/lib/fuzzy-match';
import type { CommandDefinition } from '../../client/agent/command-schema';
import { IconButton } from '../../components/icon-button';
import { ShortcutRecorder } from '../../components/shortcut-recorder';
import { shortcutKeys } from '../../lib/shortcuts';
import { agentApi } from '../agent/use-agent';
import { showErrorToast } from '../../components/toast-store';
import { CommandIcon } from './command-icon';
import { useCommandShortcutCapture } from './use-command-shortcut-capture';
import '../../components/open-row.css';

type Match = FieldsMatch<'name' | 'description'> | null;
type Row = { command: CommandDefinition; match: Match };

export interface CommandRowActions {
  /** Opens the editor; a plugin command opens it read-only. */
  onOpen: (command: CommandDefinition) => void;
  onToggle: (command: CommandDefinition, enabled: boolean) => void;
  /** Saves a shortcut recorded on the row; an empty one removes it. */
  onShortcut: (command: CommandDefinition, shortcut: string) => void;
  /** A Personal copy: a plain copy of the user's command, or Duplicate to Personal for a plugin's. */
  onDuplicate: (command: CommandDefinition) => void;
  onDelete: (command: CommandDefinition) => void;
}

/**
 * The user's commands, then each plugin's commands under its plugin id (display names are not on
 * this bridge). Saved order stays within a group; the search matches and marks what rows show.
 */
export function CommandList({
  commands,
  query,
  pendingIds,
  shortcutErrors,
  onClearSearch,
  ...actions
}: {
  commands: readonly CommandDefinition[];
  query: string;
  /** The commands being saved, whose rows' run and enable controls wait; other rows stay usable. */
  pendingIds: ReadonlySet<string>;
  shortcutErrors: Readonly<Record<string, string>>;
  onClearSearch: () => void;
} & CommandRowActions) {
  const { t } = useTranslation('commands');
  const groups = new Map<string, Row[]>([['', []]]);
  for (const command of commands) {
    const match = matchFields(query, { name: command.name, description: command.description });
    if (!match && query.trim()) continue;
    const key = command.pluginId ?? '';
    groups.set(key, [...(groups.get(key) ?? []), { command, match }]);
  }
  const titled = commands.some((command) => command.pluginId);
  const row = ({ command, match }: Row) => (
    <CommandRow
      key={command.id}
      command={command}
      match={match}
      busy={pendingIds.has(command.id)}
      shortcutError={shortcutErrors[command.id]}
      {...actions}
    />
  );
  if (query.trim() && commands.length && [...groups.values()].every((rows) => !rows.length))
    return (
      <div className="settings-extension-empty">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX />
            </EmptyMedia>
            <EmptyTitle>{t('list.noMatches', { query: query.trim() })}</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={onClearSearch}>
              {t('list.clearSearch')}
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  if (!titled) return <ItemGroup>{groups.get('')!.map(row)}</ItemGroup>;
  return (
    <div className="command-groups">
      {[...groups].map(([plugin, rows]) =>
        rows.length ? (
          <section
            key={plugin}
            className="command-group"
            aria-label={plugin ? t('list.pluginGroupFor', { plugin }) : t('list.personal')}
          >
            <h3>{plugin || t('list.personal')}</h3>
            <ItemGroup>{rows.map(row)}</ItemGroup>
          </section>
        ) : null,
      )}
    </div>
  );
}

/**
 * One row anatomy for every command: identity, shortcut, then Run, the enable Switch and More in
 * fixed positions. The user's own command records a new shortcut when its shortcut is clicked,
 * and More removes a set one, so no action appears beside the keys to shift the columns. A plugin
 * command keeps the same columns with its shortcut read-only; its More menu narrows to Duplicate
 * to Personal, since it cannot be edited or deleted.
 */
function CommandRow({
  command,
  match,
  busy,
  shortcutError,
  onOpen,
  onToggle,
  onShortcut,
  onDuplicate,
  onDelete,
}: {
  command: CommandDefinition;
  match: Match;
  /** The command is saving: its controls stay focusable but ignore input. */
  busy: boolean;
  shortcutError: string | undefined;
} & CommandRowActions) {
  const { t } = useTranslation('commands');
  const plugin = Boolean(command.pluginId);
  const recorder = useCommandShortcutCapture((shortcut) => onShortcut(command, shortcut));
  const { capture, platform } = recorder;
  const keys = command.shortcut ? shortcutKeys(command.shortcut, platform) : [];
  // A combination the row cannot use outranks the standing registration error.
  const error = recorder.error || shortcutError;
  return (
    <Item asChild size="sm" variant="outline" className="command-management-row open-row">
      <li>
        {/* A click anywhere on the row opens the editor, like the memory and skill rows;
            the run, enable and More controls stay interactive above this button. */}
        <button
          type="button"
          className="open-row-button"
          aria-label={
            plugin
              ? t('list.viewFor', { name: command.name })
              : t('list.editFor', { name: command.name })
          }
          onClick={() => onOpen(command)}
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
              <HighlightedText text={command.description} ranges={match?.ranges.description} />
            </ItemDescription>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </ItemContent>
        </div>
        <div className="command-row-controls">
          <div className="command-row-shortcut">
            {!plugin ? (
              <ShortcutRecorder
                keys={keys}
                recording={capture.isRecording}
                emptyText={t('list.setShortcut')}
                aria-label={
                  capture.isRecording
                    ? t('list.shortcutCancelFor', { name: command.name })
                    : t('list.shortcutFor', { name: command.name })
                }
                aria-disabled={busy || undefined}
                aria-busy={busy || undefined}
                className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                onBlur={capture.cancel}
                onClick={() => {
                  if (busy) return;
                  if (capture.isRecording) capture.cancel();
                  else capture.start();
                }}
              />
            ) : keys.length ? (
              <KbdGroup>
                {keys.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </KbdGroup>
            ) : (
              <span className="text-xs text-muted-foreground">{t('list.noShortcut')}</span>
            )}
          </div>
          <ItemActions className="shrink-0">
            {/* Off or saving, Run stays focusable so its tooltip can say why it does nothing. */}
            <IconButton
              label={command.enabled ? t('list.run') : t('list.runOff')}
              aria-label={t('list.runFor', { name: command.name })}
              aria-disabled={!command.enabled || busy || undefined}
              aria-busy={busy || undefined}
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              onClick={() => {
                if (!command.enabled || busy) return;
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
              aria-disabled={busy || undefined}
              aria-busy={busy || undefined}
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              onCheckedChange={(enabled) => {
                if (!busy) onToggle(command, enabled);
              }}
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
                {plugin ? (
                  <DropdownMenuItem onSelect={() => onDuplicate(command)}>
                    <Copy />
                    {t('list.duplicateToPersonal')}
                  </DropdownMenuItem>
                ) : (
                  <>
                    <DropdownMenuItem onSelect={() => onOpen(command)}>
                      <Pencil />
                      {t('common.edit')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onDuplicate(command)}>
                      <Copy />
                      {t('list.duplicate')}
                    </DropdownMenuItem>
                    {command.shortcut ? (
                      <DropdownMenuItem disabled={busy} onSelect={() => onShortcut(command, '')}>
                        <KeyboardOff />
                        {t('list.removeShortcut')}
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => onDelete(command)}>
                      <Trash2 />
                      {t('common.delete')}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </ItemActions>
        </div>
      </li>
    </Item>
  );
}
