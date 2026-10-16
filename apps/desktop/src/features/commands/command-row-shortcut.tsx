import { useTranslation } from 'react-i18next';
import { Keyboard, KeyboardOff } from 'lucide-react';
import { hasOverrides, keyedShortcuts } from '@atd/agent-contracts';
import { Kbd, KbdGroup } from '@atd/ui/components/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@atd/ui/components/tooltip';
import type { CommandDefinition } from '../../client/agent/command-schema';
import { ItemMenuItem } from '../../components/item-menu';
import { ShortcutRecorder } from '../../components/shortcut-recorder';
import { shortcutKeys } from '../../lib/shortcuts';
import { useShortcutNames } from './shortcut-names';
import type { useCommandShortcutCapture } from './use-command-shortcut-capture';

/**
 * The list row's shortcut column, a fixed width so recording never moves the actions beside it:
 * the user's own command records its first shortcut with keys in place (`withRowRecording`); a
 * plugin's shows its keys read-only. More shortcuts with keys add "+N", whose tooltip lists them
 * and which opens the editor at them.
 */
export function CommandRowShortcut({
  command,
  busy,
  recorder,
  onEdit,
}: {
  command: CommandDefinition;
  busy: boolean;
  recorder: ReturnType<typeof useCommandShortcutCapture>;
  /** Opens the editor at the command's shortcuts, which "+N" does when clicked. */
  onEdit: () => void;
}) {
  const { t } = useTranslation('commands');
  const names = useShortcutNames();
  const { capture, platform } = recorder;
  const [first, ...others] = keyedShortcuts(command);
  const keys = first ? shortcutKeys(first.accelerator, platform) : [];
  const more = others.map(
    (shortcut) =>
      `${shortcutKeys(shortcut.accelerator, platform).join('')} ${names.title(command, shortcut)}`,
  );
  return (
    <div className="command-row-shortcut">
      {!command.pluginId ? (
        <ShortcutRecorder
          keys={keys}
          recording={capture.isRecording}
          doubleTap={platform === 'darwin'}
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
          {keys.map((key, index) => (
            <Kbd key={`${index}-${key}`}>{key}</Kbd>
          ))}
        </KbdGroup>
      ) : (
        <span className="text-xs text-muted-foreground">{t('list.noShortcut')}</span>
      )}
      {more.length > 0 && !capture.isRecording && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="command-row-more-shortcuts inline-flex h-6 items-center rounded-sm px-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              aria-label={t('list.moreShortcutsFor', { list: more.join(', ') })}
              onClick={onEdit}
            >
              {t('list.moreShortcuts', { count: more.length })}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <ul>
              {more.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

/**
 * The row's More item for its shortcuts: removing the only one when it is plain (no name, no
 * overrides), which the row's recorder can set again; otherwise editing them in the editor, where
 * each one's settings live. None while the command has no shortcut.
 */
export function ShortcutMenuItem({
  command,
  busy,
  onRemove,
  onEdit,
}: {
  command: CommandDefinition;
  busy: boolean;
  onRemove: () => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation('commands');
  const [only, ...rest] = command.shortcuts;
  if (!only) return null;
  if (!rest.length && !only.name && !hasOverrides(only))
    return (
      <ItemMenuItem disabled={busy} onSelect={onRemove}>
        <KeyboardOff />
        {t('list.removeShortcut')}
      </ItemMenuItem>
    );
  return (
    <ItemMenuItem onSelect={onEdit}>
      <Keyboard />
      {t('list.editShortcuts')}
    </ItemMenuItem>
  );
}
