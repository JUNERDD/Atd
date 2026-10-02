import { ArrowUpRight } from 'lucide-react';
import { HighlightedText } from '@atd/ui/components/highlighted-text';
import { ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@atd/ui/components/item';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../components/icon-button';
import { CommandIcon } from '../commands/command-icon';
import { ExtensionGroup } from './extension-group';
import { ExtensionRow, ExtensionRowActions } from './extension-row';
import type { CommandMatch } from './use-extension-matches';

/**
 * A command of a plugin as its page and search list it. `id` is the command the Commands section
 * opens; null while the agent snapshot has not listed it yet, when the row opens the section's
 * list instead.
 */
export interface ExtensionCommandRow {
  /** The contributing plugin; the user's own commands belong to Personal (`user`). */
  pluginId: string;
  /** How the plugin lists it: a Personal command by its id, a plugin's by its qualified name. */
  itemName: string;
  id: string | null;
  name: string;
  description: string;
  enabled: boolean;
  templateId: string | null;
}

/**
 * One plugin's commands. The Commands section owns editing and Run, so a row click and Open in
 * Commands (in More's column) open that section at the command; the row keeps the command's own
 * switch, locked with the reason while its plugin is off.
 */
export function ExtensionCommandsGroup({
  title,
  showTitle = true,
  items,
  connected,
  lockedReason,
  onOpen,
  onEnabled,
}: {
  title: string;
  /** False when a tab names the kind; the section keeps its name for accessibility. */
  showTitle?: boolean;
  items: CommandMatch[];
  connected: boolean;
  lockedReason: string | null;
  onOpen: (row: ExtensionCommandRow) => void;
  onEnabled: (row: ExtensionCommandRow, enabled: boolean) => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <ExtensionGroup
      title={title}
      showTitle={showTitle}
      empty=""
      loading={false}
      hasRows={items.length > 0}
    >
      {items.map(({ row, description, match }) => (
        <ExtensionRow key={row.itemName} name={row.name} onDetails={() => onOpen(row)}>
          <ItemMedia variant="icon">
            <CommandIcon templateId={row.templateId} />
          </ItemMedia>
          <ItemContent>
            <ItemTitle title={row.name}>
              <HighlightedText text={row.name} ranges={match?.ranges.name} />
            </ItemTitle>
            {description ? (
              <ItemDescription title={description}>
                <HighlightedText text={description} ranges={match?.ranges.description} />
              </ItemDescription>
            ) : null}
          </ItemContent>
          <ExtensionRowActions
            name={row.name}
            enabled={row.enabled}
            disabled={!connected}
            lockedReason={lockedReason}
            onEnabledChange={(enabled) => onEnabled(row, enabled)}
            onDetails={() => onOpen(row)}
            trailing={
              <IconButton
                label={t('extensions.plugins.page.openInCommands')}
                aria-label={t('extensions.plugins.page.openInCommandsFor', { name: row.name })}
                onClick={() => onOpen(row)}
              >
                <ArrowUpRight />
              </IconButton>
            }
          />
        </ExtensionRow>
      ))}
    </ExtensionGroup>
  );
}
