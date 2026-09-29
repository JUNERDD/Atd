import { useTranslation } from 'react-i18next';
import { Copy, MoreHorizontal, Pencil, Play, Trash2 } from 'lucide-react';
import { HighlightedText } from '@ai/ui/components/highlighted-text';
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
import { matchFields, type FieldsMatch } from '@ai/ui/lib/fuzzy-match';
import type { CommandDefinition } from '../../client/agent/command-schema';
import { IconButton } from '../../components/icon-button';
import { shortcutKeys } from '../../lib/shortcuts';
import { agentApi } from '../agent/use-agent';
import { showErrorToast } from '../../components/toast-store';
import { CommandIcon } from './command-icon';

type Match = FieldsMatch<'name' | 'description'> | null;
type Row = { command: CommandDefinition; match: Match };

export interface CommandRowActions {
  /** Opens the editor; a plugin command opens it read-only. */
  onOpen: (command: CommandDefinition) => void;
  onToggle: (command: CommandDefinition, enabled: boolean) => void;
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
  pending,
  shortcutErrors,
  ...actions
}: {
  commands: readonly CommandDefinition[];
  query: string;
  /** While a command saves, every row's run and enable controls wait. */
  pending: boolean;
  shortcutErrors: Readonly<Record<string, string>>;
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
      pending={pending}
      shortcutError={shortcutErrors[command.id]}
      {...actions}
    />
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
 * fixed positions. A plugin command keeps the same columns; only its More menu narrows to
 * Duplicate to Personal, since it cannot be edited or deleted.
 */
function CommandRow({
  command,
  match,
  pending,
  shortcutError,
  onOpen,
  onToggle,
  onDuplicate,
  onDelete,
}: {
  command: CommandDefinition;
  match: Match;
  pending: boolean;
  shortcutError: string | undefined;
} & CommandRowActions) {
  const { t } = useTranslation('commands');
  const plugin = Boolean(command.pluginId);
  return (
    <Item asChild size="sm" variant="outline" className="command-management-row settings-open-row">
      <li>
        {/* A click anywhere on the row opens the editor, like the memory and skill rows;
            the run, enable and More controls stay interactive above this button. */}
        <button
          type="button"
          className="settings-open-row-button"
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
            {shortcutError && <p className="text-xs text-destructive">{shortcutError}</p>}
          </ItemContent>
        </div>
        <div className="command-row-controls">
          <div className="command-row-shortcut">
            {command.shortcut ? (
              <KbdGroup>
                {shortcutKeys(command.shortcut, window.desktop?.platform ?? 'web').map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </KbdGroup>
            ) : (
              <span className="text-xs text-muted-foreground">{t('list.noShortcut')}</span>
            )}
          </div>
          <ItemActions className="shrink-0">
            <IconButton
              label={t('list.run')}
              aria-label={t('list.runFor', { name: command.name })}
              disabled={!command.enabled || pending}
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
              disabled={pending}
              onCheckedChange={(enabled) => onToggle(command, enabled)}
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
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => onDelete(command)}>
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
