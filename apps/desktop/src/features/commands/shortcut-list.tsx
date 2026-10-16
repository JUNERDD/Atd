import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { hasOverrides, MAX_COMMAND_SHORTCUTS, type CommandShortcut } from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import { Card } from '@atd/ui/components/card';
import { ItemGroup } from '@atd/ui/components/item';
import { Label } from '@atd/ui/components/label';
import type { CommandDefinition } from '../../client/agent/command-schema';
import { plainShortcut } from './shortcut-drafts';
import { CommandShortcutRow } from './shortcut-input';
import { useShortcutNames } from './shortcut-names';
import { shortcutErrorId } from './use-command-problems';

/**
 * A command's global shortcuts in the editor's Launch group, a titled field like the placement
 * switches below it. Without any, the card holds one row, and recording there creates the first
 * shortcut. With some, each has a row: its name (or one made from its overrides), what it does
 * differently, its keys recorded in place, Remove before them and Edit after them, which opens the
 * shortcut's page (`onOpen`, null for a new shortcut). Add sits at the end of the field's title
 * row, as a group's action does, so the card is followed only by its notes: the limit once the
 * command has the most it can, and that another app may hold a combination once one has keys.
 */
export function ShortcutList({
  command,
  onChange,
  onOpen,
  problem,
  registrationError,
}: {
  command: CommandDefinition;
  onChange: (shortcuts: CommandShortcut[]) => void;
  onOpen: (id: string | null) => void;
  /** The editor's problem with a shortcut, in the app's language, or ''. */
  problem: (id: string) => string;
  /** The shell's registration error for a shortcut's current keys, or ''. */
  registrationError: (shortcut: CommandShortcut) => string;
}) {
  const { t } = useTranslation('commands');
  const names = useShortcutNames();
  const limitId = useId();
  const { shortcuts } = command;
  const full = shortcuts.length >= MAX_COMMAND_SHORTCUTS;
  const replace = (id: string, change: Partial<CommandShortcut>) =>
    onChange(shortcuts.map((item) => (item.id === id ? { ...item, ...change } : item)));
  function description(shortcut: CommandShortcut): string {
    if (!shortcut.accelerator) return t('shortcut.row.noKeys');
    if (!hasOverrides(shortcut)) return t('shortcut.row.sameAsCommand');
    // A named shortcut sums up its overrides here; an unnamed one's title already does.
    return shortcut.name ? names.generated(command, shortcut) : t('shortcut.row.ownSettings');
  }
  return (
    <div className="settings-field">
      <div className="settings-field-label">
        <Label id="command-shortcuts-title">{t('shortcut.list.title')}</Label>
        {shortcuts.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            disabled={full}
            aria-describedby={full ? limitId : undefined}
            onClick={() => onOpen(null)}
          >
            <Plus />
            {t('shortcut.list.add')}
          </Button>
        )}
      </div>
      <Card size="sm" className="settings-card">
        <ItemGroup aria-labelledby="command-shortcuts-title">
          {shortcuts.length === 0 ? (
            <CommandShortcutRow
              id="command-shortcut"
              title={t('shortcut.list.emptyTitle')}
              description={t('shortcut.list.emptyDescription')}
              accelerator=""
              recordLabel={t('shortcut.record')}
              error=""
              errorId="command-shortcut-error"
              onRecorded={(accelerator) => onChange([plainShortcut(accelerator)])}
            />
          ) : (
            shortcuts.map((shortcut) => {
              const name = names.title(command, shortcut);
              return (
                <CommandShortcutRow
                  key={shortcut.id}
                  id={`command-shortcut-${shortcut.id}`}
                  title={name}
                  description={description(shortcut)}
                  accelerator={shortcut.accelerator}
                  recordLabel={t('shortcut.row.recordFor', { name })}
                  error={problem(shortcut.id) || registrationError(shortcut)}
                  errorId={shortcutErrorId(shortcut.id)}
                  onRecorded={(accelerator) => replace(shortcut.id, { accelerator })}
                  remove={{
                    label: t('shortcut.row.remove'),
                    ariaLabel: t('shortcut.row.removeFor', { name }),
                    onClick: () => onChange(shortcuts.filter((item) => item.id !== shortcut.id)),
                  }}
                  edit={{
                    label: t('shortcut.row.edit'),
                    ariaLabel: t('shortcut.row.editFor', { name }),
                    onClick: () => onOpen(shortcut.id),
                  }}
                />
              );
            })
          )}
        </ItemGroup>
      </Card>
      {full && (
        <p id={limitId} className="settings-field-note">
          {t('shortcut.list.limit', { max: MAX_COMMAND_SHORTCUTS })}
        </p>
      )}
      {shortcuts.some((shortcut) => shortcut.accelerator) && (
        <p className="settings-field-note">{t('shortcut.conflictHint')}</p>
      )}
    </div>
  );
}
